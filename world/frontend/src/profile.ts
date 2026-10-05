// 首次身份填写（PRD D4 单点登录前的过渡方案）：
// 昵称 1-20 字 + 部门下拉（PRD §4 九选项）→ POST /api/profile → 服务端按 cid 持久化。

import { DEPT_LIST } from './campus'

export function showProfileModal(submit: (nickname: string, dept: string) => Promise<void>): void {
  const root = document.getElementById('profile-root')
  if (!root) return
  root.innerHTML = ''

  const overlay = document.createElement('div')
  overlay.className = 'pf-overlay'
  overlay.innerHTML = `
    <div class="pf-card">
      <h1>欢迎来到小世界</h1>
      <p class="pf-desc">首次进入请填写你的身份，填写一次即可，之后会记住你。（企微扫码登录即将接入）</p>
      <label for="pf-nick">昵称</label>
      <input id="pf-nick" maxlength="20" placeholder="1-20 个字" />
      <label for="pf-dept">部门</label>
      <select id="pf-dept">
        <option value="" disabled selected>请选择部门</option>
        ${DEPT_LIST.map((d) => `<option value="${d}">${d}</option>`).join('')}
      </select>
      <div class="pf-err" id="pf-err"></div>
      <button id="pf-go" type="button">进入小世界</button>
    </div>
  `
  root.appendChild(overlay)

  const nick = overlay.querySelector('#pf-nick') as HTMLInputElement
  const dept = overlay.querySelector('#pf-dept') as HTMLSelectElement
  const err = overlay.querySelector('#pf-err') as HTMLElement
  const go = overlay.querySelector('#pf-go') as HTMLButtonElement

  const fail = (msg: string) => {
    err.textContent = msg
    go.disabled = false
    go.textContent = '进入小世界'
  }

  go.addEventListener('click', async () => {
    const name = nick.value.trim()
    if (name.length < 1 || name.length > 20) {
      err.textContent = '昵称需要 1-20 个字'
      nick.focus()
      return
    }
    if (!dept.value) {
      err.textContent = '请选择部门'
      return
    }
    err.textContent = ''
    go.disabled = true
    go.textContent = '提交中…'
    try {
      await submit(name, dept.value)
      root.innerHTML = ''
    } catch {
      fail('提交失败，请稍后重试')
    }
  })

  nick.focus()
}
