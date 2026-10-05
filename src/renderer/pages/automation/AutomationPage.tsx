import { CalendarClock, CircleAlert, Loader2, MoreHorizontal, Play, Plus, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Spinner,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import {
  useAllTasks,
  useCreateTask,
  useDeleteTask,
  useRunTask,
  useSetTaskEnabled,
  useTaskLogs
} from '@renderer/hooks/agent/useTasks'
import { cn } from '@renderer/utils/style'
import type { ScheduledTaskListItem } from '@shared/data/api/schemas/agents'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm } from '@shared/ipc/schemas/ai'

/** 计划类型：cron 表达式 / 固定间隔 / 单次延迟。 */
type ScheduleKind = Trigger['kind']

/** 表单里间隔以分钟为单位，提交时换算毫秒（TriggerSchema 的 interval 用 ms）。 */
const INTERVAL_MINUTES_MIN = 1
const INTERVAL_MINUTES_MAX = 60 * 24 * 30
const TIMEOUT_MINUTES_DEFAULT = 30

/** 计划 → 摘要文案（列表 chip 与下次运行时间并列展示）。 */
function describeTrigger(trigger: Trigger): string {
  if (trigger.kind === 'cron') return trigger.expr
  if (trigger.kind === 'interval') {
    const minutes = Math.round(trigger.ms / 60000)
    return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}min`
  }
  return new Date(trigger.at).toLocaleString()
}

/** 运行态徽标（runSummary 来自 /agent-tasks 的聚合列）。 */
const RunSummaryBadge: FC<{ task: ScheduledTaskListItem }> = ({ task }) => {
  const { t } = useTranslation()
  const summary = task.runSummary
  if (!summary) return null
  const tone =
    summary.status === 'completed'
      ? 'text-emerald-600'
      : summary.status === 'failed'
        ? 'text-red-500'
        : summary.status === 'running'
          ? 'text-blue-500'
          : 'text-muted-foreground'
  return (
    <Badge variant="outline" className={cn('shrink-0 text-[11px] font-normal', tone)}>
      {t(`automation.status.${summary.status}`)}
    </Badge>
  )
}

/** 单条任务的运行记录（展开后懒加载最近若干条）。 */
const TaskLogsPanel: FC<{ agentId: string; taskId: string }> = ({ agentId, taskId }) => {
  const { t } = useTranslation()
  const { logs, isLoading } = useTaskLogs(agentId, taskId)
  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner text="" className="text-muted-foreground" />
      </div>
    )
  }
  if (logs.length === 0) {
    return <p className="px-2 py-3 text-xs text-muted-foreground">{t('automation.logs.empty')}</p>
  }
  return (
    <ul className="flex flex-col gap-1.5" data-ui="automation.logs">
      {logs.slice(0, 10).map((log) => (
        <li key={log.id} className="flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
          <span className="shrink-0">{new Date(log.startedAt).toLocaleString()}</span>
          <span
            className={cn(
              'shrink-0 font-medium',
              log.status === 'completed'
                ? 'text-emerald-600'
                : log.status === 'failed'
                  ? 'text-red-500'
                  : log.status === 'running'
                    ? 'text-blue-500'
                    : ''
            )}>
            {t(`automation.status.${log.status}`)}
          </span>
          {log.durationMs !== null && <span className="shrink-0">{Math.round(log.durationMs / 1000)}s</span>}
          {log.error && <span className="min-w-0 truncate text-red-500">{log.error}</span>}
        </li>
      ))}
    </ul>
  )
}

interface CreateTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 新建任务弹窗：名称/智能体/提示词/计划（cron|间隔|单次）/超时/复用会话。 */
const CreateTaskDialog: FC<CreateTaskDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useTranslation()
  const { data: agentsData } = useQuery('/agents', { query: { limit: 200 }, enabled: open })
  const { createTask } = useCreateTask()
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('interval')
  const [cronExpr, setCronExpr] = useState('0 9 * * 1-5')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [timeoutMinutes, setTimeoutMinutes] = useState(TIMEOUT_MINUTES_DEFAULT)
  const [reuseSession, setReuseSession] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const agents = agentsData?.items ?? []

  const submit = async () => {
    if (!name.trim() || !agentId || !prompt.trim()) return
    let trigger: Trigger
    if (scheduleKind === 'cron') {
      trigger = { kind: 'cron', expr: cronExpr.trim() }
    } else if (scheduleKind === 'interval') {
      trigger = { kind: 'interval', ms: intervalMinutes * 60_000 }
    } else {
      trigger = { kind: 'once', at: Date.now() + 5 * 60_000 }
    }
    const form: AgentTaskForm = {
      name: name.trim(),
      prompt: prompt.trim(),
      trigger,
      workspace: { type: 'system' },
      timeoutMinutes,
      reuseSession
    }
    setSubmitting(true)
    const created = await createTask(agentId, form)
    setSubmitting(false)
    if (created) {
      setName('')
      setAgentId('')
      setPrompt('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent size="sm" data-ui="automation.create-dialog">
        <DialogHeader>
          <DialogTitle>{t('automation.create.title')}</DialogTitle>
          <DialogDescription>{t('automation.create.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('automation.create.name')}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('automation.create.namePlaceholder')}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('automation.create.agent')}
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">{t('automation.create.agentPlaceholder')}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('automation.create.prompt')}
            <Textarea.Input
              rows={4}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t('automation.create.promptPlaceholder')}
            />
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0">{t('automation.create.schedule')}</span>
            <select
              value={scheduleKind}
              onChange={(event) => setScheduleKind(event.target.value as ScheduleKind)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="interval">{t('automation.create.schedule.interval')}</option>
              <option value="cron">{t('automation.create.schedule.cron')}</option>
              <option value="once">{t('automation.create.schedule.once')}</option>
            </select>
            {scheduleKind === 'cron' ? (
              <Input value={cronExpr} onChange={(event) => setCronExpr(event.target.value)} className="font-mono" />
            ) : scheduleKind === 'interval' ? (
              <Input
                type="number"
                min={INTERVAL_MINUTES_MIN}
                max={INTERVAL_MINUTES_MAX}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              />
            ) : (
              <span className="text-xs text-muted-foreground">{t('automation.create.schedule.onceHint')}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0">{t('automation.create.timeout')}</span>
            <Input
              type="number"
              min={1}
              max={720}
              value={timeoutMinutes}
              onChange={(event) => setTimeoutMinutes(Number(event.target.value))}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">{t('automation.create.timeoutUnit')}</span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={reuseSession} onCheckedChange={setReuseSession} />
            {t('automation.create.reuseSession')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={submitting || !name.trim() || !agentId || !prompt.trim()} onClick={() => void submit()}>
            {submitting ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {t('automation.create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const AutomationPage: FC = () => {
  const { t } = useTranslation()
  const { tasks, isLoading, error, refetch } = useAllTasks()
  const { setTaskEnabled } = useSetTaskEnabled()
  const { runTask } = useRunTask()
  const { deleteTask } = useDeleteTask()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTaskListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [logsTaskId, setLogsTaskId] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const ok = await deleteTask(deleteTarget.agentId, deleteTarget.id)
    setDeleting(false)
    if (ok) setDeleteTarget(null)
  }

  return (
    <div data-ui="automation.view" className="flex h-full min-h-0 flex-1 flex-col text-foreground">
      <Navbar>
        <NavbarCenter className="border-r-0">{t('automation.title')}</NavbarCenter>
      </Navbar>

      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight" data-ui="automation.page-title">
              {t('automation.title')}
            </h1>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground" data-ui="automation.subtitle">
                {t('automation.subtitle')}
              </p>
              <Button data-ui="automation.create" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t('automation.create.title')}
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center py-20" data-ui="automation.loading">
              <Spinner text={t('common.loading')} className="text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-1 items-center justify-center py-16" data-ui="automation.error">
              <EmptyState
                icon={CircleAlert}
                title={t('automation.error.title')}
                actionLabel={t('market.retry')}
                onAction={() => void refetch()}
                compact
              />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-16" data-ui="automation.empty">
              <EmptyState
                icon={CalendarClock}
                title={t('automation.empty.title')}
                description={t('automation.empty.description')}
                actionLabel={t('automation.create.title')}
                onAction={() => setCreateOpen(true)}
                compact
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1" data-ui="automation.list">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  data-ui="automation.item"
                  className="flex flex-col rounded-xl transition-colors hover:bg-accent">
                  <div data-ui="automation.row" className="flex min-w-0 items-center gap-3 px-2 py-3">
                    <span
                      aria-hidden
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        task.status === 'active'
                          ? 'bg-emerald-500'
                          : task.status === 'paused'
                            ? 'bg-amber-500'
                            : task.status === 'missed'
                              ? 'bg-red-500'
                              : 'bg-muted-foreground/40'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-semibold">{task.name}</span>
                        <RunSummaryBadge task={task} />
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="shrink-0 font-mono">{describeTrigger(task.trigger)}</span>
                        {task.lastRun && (
                          <span className="shrink-0 whitespace-nowrap">
                            {t('automation.lastRun')}: {new Date(task.lastRun).toLocaleString()}
                          </span>
                        )}
                        {task.nextRun && (
                          <span className="shrink-0 whitespace-nowrap">
                            {t('automation.nextRun')}: {new Date(task.nextRun).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch
                        checked={task.enabled}
                        onCheckedChange={(checked) => void setTaskEnabled(task.agentId, task.id, checked)}
                      />
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('market.actions')}
                            data-ui="automation.row.menu"
                            onClick={(event) => event.stopPropagation()}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                          <DropdownMenuItem
                            onSelect={(event) => {
                              event.stopPropagation()
                              void runTask(task.agentId, task.id)
                            }}>
                            <Play />
                            {t('automation.runNow')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={(event) => {
                              event.stopPropagation()
                              setLogsTaskId(logsTaskId === task.id ? null : task.id)
                            }}>
                            <CalendarClock />
                            {t('automation.logs.title')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={(event) => {
                              event.stopPropagation()
                              setDeleteTarget(task)
                            }}>
                            <Trash2 />
                            {t('agent.tasks.delete.label')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {logsTaskId === task.id && <TaskLogsPanel agentId={task.agentId} taskId={task.id} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </Scrollbar>

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent size="sm" showCloseButton={false} data-ui="automation.delete-dialog">
          <DialogHeader>
            <DialogTitle>{t('automation.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('automation.delete.description', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
              {t('agent.tasks.delete.label')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AutomationPage
