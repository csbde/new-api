import { api, type ApiRequestConfig } from '@/lib/api'

import type { Combo, ComboListResponse } from './types'

interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
}

const mutationConfig: ApiRequestConfig = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

export async function listCombos(params: {
  page?: number
  pageSize?: number
  keyword?: string
  strategy?: string
  status?: number
}) {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set('p', String(params.page))
  if (params.pageSize) searchParams.set('page_size', String(params.pageSize))
  if (params.keyword) searchParams.set('keyword', params.keyword)
  if (params.strategy) searchParams.set('strategy', params.strategy)
  if (params.status) searchParams.set('status', String(params.status))

  const res = await api.get<ApiResponse<ComboListResponse>>(
    `/api/combo/?${searchParams.toString()}`
  )
  return res.data.data
}

export async function getCombo(id: number) {
  const res = await api.get<ApiResponse<Combo>>(`/api/combo/${id}`)
  return res.data.data
}

export async function createCombo(data: Partial<Combo>) {
  const res = await api.post<ApiResponse<Combo>>(
    '/api/combo/',
    data,
    mutationConfig
  )
  return res.data
}

export async function updateCombo(data: Partial<Combo>) {
  const res = await api.put<ApiResponse<Combo>>(
    '/api/combo/',
    data,
    mutationConfig
  )
  return res.data
}

export async function deleteCombo(id: number) {
  const res = await api.delete<ApiResponse<null>>(
    `/api/combo/${id}`,
    mutationConfig
  )
  return res.data
}

export async function toggleComboStatus(id: number, status?: number) {
  const res = await api.post<ApiResponse<number>>(
    `/api/combo/${id}/status`,
    status ? { status } : {},
    mutationConfig
  )
  return res.data
}
