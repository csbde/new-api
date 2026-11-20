export type ComboStrategy =
  | 'fallback'
  | 'round_robin'
  | 'smart_router'
  | 'fusion'

export type ComboSmartMode = 'smart_switch' | 'strict_lock' | 'per_turn'

export interface ComboStrategySettings {
  decision_model?: string
  smart_mode?: ComboSmartMode
  hysteresis_threshold?: number
  decision_prompt?: string
  judge_model?: string
  synthesis_prompt?: string
  temperature?: number
}

export interface Combo {
  id: number
  name: string
  description?: string
  strategy: ComboStrategy
  models: string[]
  settings?: ComboStrategySettings
  group?: string
  status: number // 1: enabled, 2: disabled
  user_id: number
  created_time: number
  updated_time: number
}

export interface ComboListResponse {
  items: Combo[]
  total: number
  page: number
  size: number
}
