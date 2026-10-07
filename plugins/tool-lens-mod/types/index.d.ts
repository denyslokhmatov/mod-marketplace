export type Cat = 'read' | 'search' | 'skill' | 'app' | 'command' | 'agent' | 'edit' | 'web' | 'other'
export type Size = 'small' | 'medium' | 'large'

export type Step = {
  id: string
  cat: Cat
  title: string
  doing: string
  todo: string
  detail: string
  startedAt: number
  ms: number | null
  size: Size | null
  status: 'running' | 'done' | 'error'
}

// What the model is doing right now, from the turn's own request stream (null between requests).
export type Phase = 'waiting' | 'thinking' | 'writing' | 'choosing' | null

// How a finished turn ended: answered, interrupted, declined by the model, or cut off by an error.
export type Ending = 'answer' | 'aborted' | 'refusal' | 'error'
export type Turn = { title: string; startedAt: number; endedAt: number | null; reason?: Ending }
export type Todo = { content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    'tool-lens-mod': {
      steps: Step[]
      turn: Turn | null
      todos: Todo[]
      mode: 'min' | 'max'
      now: number
      prev: { steps: Step[]; turn: Turn | null } | null
      phase: Phase
      asking: string[]
      enabled: boolean
    }
  }
}
