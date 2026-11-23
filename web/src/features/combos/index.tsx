import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  GitFork,
  Network,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { deleteCombo, listCombos, toggleComboStatus } from './api'
import { ComboMutateDialog } from './components/combo-mutate-dialog'
import type { Combo, ComboStrategy } from './types'

export function Combos() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [keyword, setKeyword] = useState('')
  const [strategyFilter, setStrategyFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null)
  const [deletingCombo, setDeletingCombo] = useState<Combo | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['combos', keyword, strategyFilter],
    queryFn: () =>
      listCombos({
        keyword: keyword.trim() || undefined,
        strategy: strategyFilter !== 'all' ? strategyFilter : undefined,
      }),
  })

  const combos = data?.items || []

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      toggleComboStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['combos'] })
      toast.success(t('Combo status updated'))
    },
    onError: (err: Error) => {
      toast.error(err.message || t('Failed to update status'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCombo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['combos'] })
      toast.success(t('Combo deleted successfully'))
      setDeletingCombo(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || t('Failed to delete combo'))
    },
  })

  const getStrategyBadge = (strat: ComboStrategy) => {
    switch (strat) {
      case 'fallback':
        return (
          <Badge variant='outline' className='border-blue-500/40 text-blue-600 dark:text-blue-400 gap-1'>
            <GitFork className='h-3 w-3' />
            {t('Fallback')}
          </Badge>
        )
      case 'round_robin':
        return (
          <Badge variant='outline' className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400 gap-1'>
            <Shuffle className='h-3 w-3' />
            {t('Round Robin')}
          </Badge>
        )
      case 'smart_router':
        return (
          <Badge variant='outline' className='border-purple-500/40 text-purple-600 dark:text-purple-400 gap-1'>
            <Zap className='h-3 w-3' />
            {t('Smart Router')}
          </Badge>
        )
      case 'fusion':
        return (
          <Badge variant='outline' className='border-amber-500/40 text-amber-600 dark:text-amber-400 gap-1'>
            <Sparkles className='h-3 w-3' />
            {t('Fusion')}
          </Badge>
        )
      default:
        return <Badge variant='secondary'>{strat}</Badge>
    }
  }

  const renderSettingsSummary = (combo: Combo) => {
    if (combo.strategy === 'smart_router') {
      const mode = combo.settings?.smart_mode || 'smart_switch'
      let modeLabel = t('Per-Turn')
      if (mode === 'strict_lock') {
        modeLabel = t('Strict Lock (+0ms)')
      } else if (mode === 'smart_switch') {
        modeLabel = t('Smart Switch')
      }
      return (
        <div className='text-xs space-y-0.5 text-muted-foreground'>
          <div>
            {t('Decision')}: <span className='font-mono font-medium text-foreground'>{combo.settings?.decision_model || 'default'}</span>
          </div>
          <div>
            {t('Mode')}: <span className='font-medium text-foreground'>{modeLabel}</span>
          </div>
        </div>
      )
    }

    if (combo.strategy === 'fusion') {
      return (
        <div className='text-xs space-y-0.5 text-muted-foreground'>
          <div>
            {t('Judge')}: <span className='font-mono font-medium text-foreground'>{combo.settings?.judge_model || combo.models[0]}</span>
          </div>
          <div>
            {t('Panel')}: <span className='font-medium text-foreground'>{combo.models.length} {t('models (parallel)')}</span>
          </div>
        </div>
      )
    }

    return (
      <span className='text-xs text-muted-foreground'>
        {combo.models.length} {t('models')}
      </span>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <div className='flex items-center gap-2'>
          <Network className='h-6 w-6 text-primary' />
          <span>{t('Combos (Model Routing)')}</span>
        </div>
      </SectionPageLayout.Title>

      <SectionPageLayout.Actions>
        <Button
          onClick={() => {
            setEditingCombo(null)
            setDialogOpen(true)
          }}
          className='gap-1.5'
        >
          <Plus className='h-4 w-4' />
          {t('Create Combo')}
        </Button>
      </SectionPageLayout.Actions>

      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <div className='text-sm text-muted-foreground'>
            {t(
              'Group models under one virtual name, then pick a strategy per combo: Fallback, Round Robin, Smart Router, or Fusion.'
            )}
          </div>

          <div className='flex flex-col sm:flex-row gap-3 items-center justify-between'>
            <div className='flex items-center gap-2 w-full sm:w-auto flex-1 max-w-sm'>
              <div className='relative w-full'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t('Search combos...')}
                  className='pl-9'
                />
              </div>
            </div>

            <div className='flex items-center gap-2 w-full sm:w-auto'>
              <Select
                value={strategyFilter}
                onValueChange={(val) => setStrategyFilter(val)}
              >
                <SelectTrigger className='w-[180px]'>
                  <SelectValue placeholder={t('Filter Strategy')} />
                </SelectTrigger>
                <SelectContent className='w-auto min-w-(--anchor-width)' align='start' alignItemWithTrigger={false}>
                  <SelectItem value='all'>{t('All Strategies')}</SelectItem>
                  <SelectItem value='fallback'>{t('Fallback')}</SelectItem>
                  <SelectItem value='round_robin'>{t('Round Robin')}</SelectItem>
                  <SelectItem value='smart_router'>{t('Smart Router')}</SelectItem>
                  <SelectItem value='fusion'>{t('Fusion')}</SelectItem>
                </SelectContent>
              </Select>

              <Button variant='outline' size='icon' onClick={() => refetch()} title={t('Refresh')}>
                <RotateCw className='h-4 w-4' />
              </Button>
            </div>
          </div>

          <div className='rounded-md border bg-card'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[200px]'>{t('Virtual Model Name')}</TableHead>
                  <TableHead className='w-[130px]'>{t('Strategy')}</TableHead>
                  <TableHead className='w-[140px]'>{t('Groups')}</TableHead>
                  <TableHead>{t('Target Models')}</TableHead>
                  <TableHead className='w-[180px]'>{t('Configuration')}</TableHead>
                  <TableHead className='w-[90px] text-center'>{t('Status')}</TableHead>
                  <TableHead className='w-[100px] text-right'>{t('Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>
                      {t('Loading combos...')}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && combos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className='text-center py-12 text-muted-foreground'>
                      {t('No combos found. Click "Create Combo" to add your first routing combo.')}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && combos.length > 0 &&
                  combos.map((combo) => (
                    <TableRow key={combo.id}>
                      <TableCell className='font-medium'>
                        <div className='flex items-center gap-1.5'>
                          <span className='font-mono font-semibold'>{combo.name}</span>
                          <CopyButton value={combo.name} size='icon' variant='ghost' className='h-6 w-6' />
                        </div>
                        {combo.description && (
                          <div className='text-xs text-muted-foreground mt-0.5 line-clamp-1'>
                            {combo.description}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>{getStrategyBadge(combo.strategy)}</TableCell>

                      <TableCell>
                        {!combo.group || combo.group === 'all' ? (
                          <Badge variant='outline' className='text-xs text-muted-foreground'>
                            {t('All Groups')}
                          </Badge>
                        ) : (
                          <div className='flex flex-wrap gap-1'>
                            {combo.group
                              .split(',')
                              .map((g) => g.trim())
                              .filter(Boolean)
                              .map((g) => (
                                <Badge key={g} variant='secondary' className='text-xs font-mono py-0.5'>
                                  {g}
                                </Badge>
                              ))}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          {combo.models.map((m, idx) => (
                            <Badge key={m} variant='secondary' className='text-xs font-mono py-0.5'>
                              <span className='opacity-50 mr-1'>{idx + 1}.</span>
                              {m}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>

                      <TableCell>{renderSettingsSummary(combo)}</TableCell>

                      <TableCell className='text-center'>
                        <Switch
                          checked={combo.status === 1}
                          onCheckedChange={(checked) =>
                            toggleStatusMutation.mutate({
                              id: combo.id,
                              status: checked ? 1 : 2,
                            })
                          }
                        />
                      </TableCell>

                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-1'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-8 w-8'
                            onClick={() => {
                              setEditingCombo(combo)
                              setDialogOpen(true)
                            }}
                          >
                            <Pencil className='h-4 w-4' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-8 w-8 text-destructive hover:text-destructive'
                            onClick={() => setDeletingCombo(combo)}
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <ComboMutateDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          combo={editingCombo}
          onSuccess={() => refetch()}
        />

        <ConfirmDialog
          open={Boolean(deletingCombo)}
          onOpenChange={(open) => !open && setDeletingCombo(null)}
          title={t('Delete Combo')}
          desc={t('Are you sure you want to delete combo "{{name}}"? This action cannot be undone.', {
            name: deletingCombo?.name,
          })}
          destructive
          confirmText={t('Delete')}
          handleConfirm={() => {
            if (deletingCombo) {
              deleteMutation.mutate(deletingCombo.id)
            }
          }}
          isLoading={deleteMutation.isPending}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
