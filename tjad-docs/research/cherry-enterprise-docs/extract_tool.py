import re, subprocess, os, sys

BASE = "https://docs.enterprise.cherry-ai.com"
KEEP = {'h1','h2','h3','h4','h5','h6','li','p','td','th','img','code','pre','a','blockquote'}

def curl(url):
    r = subprocess.run(["curl","-sL","--compressed","--retry","3","-m","30",url],capture_output=True)
    return r.stdout.decode("utf-8", "replace")

def js_unescape(s):
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i+1 < len(s):
            n = s[i+1]
            if n == 'n': out.append('\n')
            elif n == 't': out.append(' ')
            elif n == 'u':
                try: out.append(chr(int(s[i+2:i+6],16))); i += 4
                except ValueError: out.append(n)
            else: out.append(n)
            i += 2
        else:
            out.append(c); i += 1
    return ''.join(out)

def balanced(s, start):
    open_ch = s[start]
    if open_ch == '"':
        i, n = start+1, len(s)
        while i < n:
            if s[i] == '\\': i += 2; continue
            if s[i] == '"': return i+1
            i += 1
        return -1
    if open_ch not in ('{','['):
        return -1
    close_ch = {'{':'}','[':']'}[open_ch]
    depth, i, n = 0, start, len(s)
    while i < n:
        c = s[i]
        if c == '"':
            i += 1
            while i < n:
                if s[i] == '\\': i += 2; continue
                if s[i] == '"': break
                i += 1
        elif c == open_ch: depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0: return i+1
        i += 1
    return -1

def strings_in(seg):
    out, i, n = [], 0, len(seg)
    while i < n:
        if seg[i] == '"':
            e = balanced(seg, i)
            if e < 0: break
            out.append(js_unescape(seg[i+1:e-1]))
            i = e
        else:
            i += 1
    return out

CALL_RE = re.compile(r'\.jsx(?:s)?\(\s*(?:([A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)|"(h[1-6]|td|th|li|p|img|code|pre|a|blockquote)")\s*,')

def md_from_body(body):
    lines, consumed_end = [], -1
    for m in CALL_RE.finditer(body):
        if m.start() < consumed_end: continue
        tag = m.group(2) or m.group(3)
        bo = body.find('{', m.end()-1)
        if bo < 0: continue
        be = balanced(body, bo)
        if be < 0: continue
        props = body[bo:be]
        ci = props.find('children:')
        if ci < 0: continue
        if tag not in KEEP and tag != 'img': continue  # containers: descend into nested calls
        consumed_end = be
        vi = ci + len('children:')
        while vi < len(props) and props[vi] in ' \n': vi += 1
        ve = balanced(props, vi)
        if ve < 0: continue
        seg = props[vi:ve]
        if tag == 'img':
            im = re.search(r'src:"([^"]+)"', seg)
            al = re.search(r'alt:"([^"]*)"', seg)
            if im: lines.append(f"\n![{js_unescape(al.group(1)) if al else ''}]({im.group(1)})\n")
            continue
        if tag not in KEEP: continue
        if props[vi] == '"':
            t = js_unescape(seg[1:-1])
        else:
            t = ' '.join(strings_in(seg))
        t = re.sub(r'\s+', ' ', t).strip()
        if not t: continue
        if tag in ('h1','h2','h3','h4','h5','h6'):
            lines.append('\n' + '#'*int(tag[1]) + ' ' + t)
        elif tag == 'li': lines.append('- ' + t)
        elif tag in ('td','th'): lines.append('| ' + t + ' |')
        elif tag == 'blockquote': lines.append('> ' + t)
        else: lines.append(t)
    return '\n'.join(lines)

def extract_page(chunk):
    src = curl(f"{BASE}/assets/{chunk}")
    if not src or len(src) < 200 or src.lstrip().startswith('<!DOCTYPE'): return None
    fm = {}
    m = re.search(r'\{title:"((?:[^"\\]|\\.)*)",description:"((?:[^"\\]|\\.)*)"\}', src)
    if m:
        fm['title'], fm['description'] = js_unescape(m.group(1)), js_unescape(m.group(2))
    fi = src.find('.jsx')
    if fi < 0: return fm, ''
    body = src[max(0, fi-3000):]
    return fm, md_from_body(body)

if __name__ == '__main__':
    pagejs = open('/tmp/page.js').read()
    mmap = dict(re.findall(r'"\./zh/([a-z0-9/_-]+)\.mdx":\(\)=>r\(\(\)=>import\("\./([A-Za-z0-9_-]+\.js)"', pagejs))
    print(f"{len(mmap)} zh pages", file=sys.stderr)
    os.makedirs('/tmp/csdocs', exist_ok=True)
    ok = 0
    for path, chunk in sorted(mmap.items()):
        try:
            r = extract_page(chunk)
            if not r or (not r[1].strip() and not r[0].get('title')):
                print(f"EMPTY {path}", file=sys.stderr); continue
            fm, md = r
            out = f"---\ntitle: {fm.get('title','')}\ndescription: {fm.get('description','')}\n---\n\n# {fm.get('title','')}\n\n{md}\n"
            with open(f"/tmp/csdocs/{path.replace('/','_')}.md","w") as f: f.write(out)
            ok += 1
            sz = len(md)
            print(f"OK {path} ({sz}B)", file=sys.stderr)
        except Exception as e:
            print(f"ERR {path}: {e}", file=sys.stderr)
    print(f"done: {ok}/{len(mmap)}", file=sys.stderr)
