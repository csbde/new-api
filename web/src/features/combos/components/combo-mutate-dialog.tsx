import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { createCombo, updateCombo } from '../api'
import type { Combo, ComboSmartMode, ComboStrategy } from '../types'

interface ComboMutateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  combo?: Combo | null
  onSuccess: () => void
}

export function ComboMutateDialog({
  open,
  onOpenChange,
  combo,
  onSuccess,
}: ComboMutateDialogProps) {
  const { t } = useTranslation()
  const isEdit = Boolean(combo?.id)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [strategy, setStrategy] = useState<ComboStrategy>('fallback')
  const [models, setModels] = useState<string[]>([])
  const [modelInput, setModelInput] = useState('')
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState<number>(1)

  // Smart Router settings
  const [decisionModel, setDecisionModel] = useState('')
  const [smartMode, setSmartMode] = useState<ComboSmartMode>('smart_switch')
  const [hysteresisThreshold, setHysteresisThreshold] = useState<number>(0.2)
  const [decisionPrompt, setDecisionPrompt] = useState('')

  // Fusion settings
  const [judgeModel, setJudgeModel] = useState('')
  const [synthesisPrompt, setSynthesisPrompt] = useState('')
  const [temperature, setTemperature] = useState<number>(0.7)

  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      if (combo) {
        setName(combo.name || '')
        setDescription(combo.description || '')
        setStrategy(combo.strategy || 'fallback')
        setModels(combo.models ? [...combo.models] : [])
        setGroup(combo.group || '')
        setStatus(combo.status ?? 1)

        setDecisionModel(combo.settings?.decision_model || '')
        setSmartMode(combo.settings?.smart_mode || 'smart_switch')
        setHysteresisThreshold(combo.settings?.hysteresis_threshold ?? 0.2)
        setDecisionPrompt(combo.settings?.decision_prompt || '')

        setJudgeModel(combo.settings?.judge_model || '')
        setSynthesisPrompt(combo.settings?.synthesis_prompt || '')
        setTemperature(combo.settings?.temperature ?? 0.7)
      } else {
        setName('')
        setDescription('')
        setStrategy('fallback')
        setModels([])
        setGroup('')
        setStatus(1)

        setDecisionModel('gpt-4o-mini')
        setSmartMode('smart_switch')
        setHysteresisThreshold(0.2)
        setDecisionPrompt('')

        setJudgeModel('')
        setSynthesisPrompt('')
        setTemperature(0.7)
      }
      setModelInput('')
    }
  }, [open, combo])

  const handleAddModel = () => {
    const trimmed = modelInput.trim()
    if (!trimmed) return
    if (models.includes(trimmed)) {
      toast.error(t('Model already in candidate list'))
      return
    }
    setModels([...models, trimmed])
    setModelInput('')
  }

  const handleRemoveModel = (indexToRemove: number) => {
    setModels(models.filter((_, idx) => idx !== indexToRemove))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error(t('Combo name is required'))
      return
    }
    if (models.length === 0) {
      toast.error(t('At least one candidate model is required'))
      return
    }

    setIsSubmitting(true)
    try {
      const payload: Partial<Combo> = {
        name: trimmedName,
        description: description.trim(),
        strategy,
        models,
        group: group.trim(),
        status,
        settings: {
          decision_model: decisionModel.trim(),
          smart_mode: smartMode,
          hysteresis_threshold: Number(hysteresisThreshold) || 0.2,
          decision_prompt: decisionPrompt.trim(),
          judge_model: judgeModel.trim() || models[0],
          synthesis_prompt: synthesisPrompt.trim(),
          temperature: Number(temperature) || 0.7,
        },
      }

      if (isEdit && combo?.id) {
        payload.id = combo.id
        await updateCombo(payload)
        toast.success(t('Combo updated successfully'))
      } else {
        await createCombo(payload)
        toast.success(t('Combo created successfully'))
      }

      onSuccess()
      onOpenChange(false)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Operation failed')
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[600px] max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Edit Combo') : t('Create Combo')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Group models under one virtual name and configure intelligent routing.'
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4 py-2'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='combo-name'>{t('Combo Name')}</Label>
              <Input
                id='combo-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. coding-combo, smart-router'
                required
              />
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='combo-strategy'>{t('Strategy')}</Label>
              <Select
                value={strategy}
                onValueChange={(val) => setStrategy(val as ComboStrategy)}
              >
                <SelectTrigger id='combo-strategy'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='fallback'>
                    {t('Fallback (Sequential Failover)')}
                  </SelectItem>
                  <SelectItem value='round_robin'>
                    {t('Round Robin (Load Spread)')}
                  </SelectItem>
                  <SelectItem value='smart_router'>
                    {t('Smart Router (System One)')}
                  </SelectItem>
                  <SelectItem value='fusion'>
                    {t('Fusion (Parallel Panel + Judge)')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='combo-desc'>{t('Description')}</Label>
            <Input
              id='combo-desc'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('Optional description')}
            />
          </div>

          <div className='space-y-2'>
            <Label>{t('Candidate Models (In Priority / Order)')}</Label>
            <div className='flex gap-2'>
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddModel()
                  }
                }}
                placeholder={t('Type model name (e.g. claude-3-7-sonnet) and press Enter')}
              />
              <Button type='button' variant='secondary' onClick={handleAddModel}>
                <Plus className='h-4 w-4 mr-1' />
                {t('Add')}
              </Button>
            </div>

            {models.length > 0 ? (
              <div className='flex flex-wrap gap-1.5 p-2 rounded-md border bg-muted/40 min-h-[42px] items-center'>
                {models.map((m, idx) => (
                  <Badge key={m} variant='secondary' className='gap-1 pr-1 py-1'>
                    <span className='text-xs opacity-60 mr-0.5'>{idx + 1}.</span>
                    <span>{m}</span>
                    <button
                      type='button'
                      onClick={() => handleRemoveModel(idx)}
                      className='rounded-full hover:bg-muted p-0.5 ml-1'
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className='text-xs text-muted-foreground'>
                {t('No candidate models added yet. Please add at least one.')}
              </p>
            )}
          </div>

          {/* Strategy Specific Settings */}
          {strategy === 'smart_router' && (
            <div className='rounded-lg border p-3.5 space-y-3 bg-muted/20'>
              <div className='font-medium text-sm flex items-center justify-between'>
                <span>{t('Smart Router (System One Settings)')}</span>
                <Badge variant='outline' className='text-xs'>
                  {t('Prompt-Cache Optimized')}
                </Badge>
              </div>

              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='smart-decision-model'>
                    {t('Decision Model')}
                  </Label>
                  <Input
                    id='smart-decision-model'
                    value={decisionModel}
                    onChange={(e) => setDecisionModel(e.target.value)}
                    placeholder='e.g. gpt-4o-mini'
                  />
                  <p className='text-xs text-muted-foreground'>
                    {t('Fast model to evaluate prompt complexity')}
                  </p>
                </div>

                <div className='space-y-1.5'>
                  <Label htmlFor='smart-mode'>{t('Session Stickiness Mode')}</Label>
                  <Select
                    value={smartMode}
                    onValueChange={(val) => setSmartMode(val as ComboSmartMode)}
                  >
                    <SelectTrigger id='smart-mode'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='smart_switch'>
                        {t('Smart Switch (Adaptive Hysteresis)')}
                      </SelectItem>
                      <SelectItem value='strict_lock'>
                        {t('Strict Lock (1 Task = 1 Session, +0ms)')}
                      </SelectItem>
                      <SelectItem value='per_turn'>
                        {t('Per-Turn (Evaluate Every Turn)')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {smartMode === 'smart_switch' && (
                <div className='space-y-1.5'>
                  <Label htmlFor='hysteresis-thresh'>
                    {t('Hysteresis Switching Threshold')} ({hysteresisThreshold})
                  </Label>
                  <Input
                    id='hysteresis-thresh'
                    type='number'
                    step='0.05'
                    min='0.05'
                    max='0.95'
                    value={hysteresisThreshold}
                    onChange={(e) =>
                      setHysteresisThreshold(parseFloat(e.target.value) || 0.2)
                    }
                  />
                  <p className='text-xs text-muted-foreground'>
                    {t(
                      'Confidence threshold needed to switch models, preventing flapping and retaining prompt cache.'
                    )}
                  </p>
                </div>
              )}

              <div className='space-y-1.5'>
                <Label htmlFor='smart-prompt'>
                  {t('Custom Decision Prompt (Optional)')}
                </Label>
                <Textarea
                  id='smart-prompt'
                  rows={2}
                  value={decisionPrompt}
                  onChange={(e) => setDecisionPrompt(e.target.value)}
                  placeholder={t('Leave blank to use default routing instructions')}
                />
              </div>
            </div>
          )}

          {strategy === 'fusion' && (
            <div className='rounded-lg border p-3.5 space-y-3 bg-muted/20'>
              <div className='font-medium text-sm flex items-center justify-between'>
                <span>{t('Fusion Settings')}</span>
                <Badge variant='outline' className='text-xs'>
                  {t('N+1 Calls (Parallel + Judge)')}
                </Badge>
              </div>

              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='fusion-judge-model'>{t('Judge Model')}</Label>
                  <Input
                    id='fusion-judge-model'
                    value={judgeModel}
                    onChange={(e) => setJudgeModel(e.target.value)}
                    placeholder={t('Leave blank to use primary candidate')}
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label htmlFor='fusion-temp'>
                    {t('Judge Temperature')} ({temperature})
                  </Label>
                  <Input
                    id='fusion-temp'
                    type='number'
                    step='0.1'
                    min='0'
                    max='2'
                    value={temperature}
                    onChange={(e) =>
                      setTemperature(parseFloat(e.target.value) || 0.7)
                    }
                  />
                </div>
              </div>

              <div className='space-y-1.5'>
                <Label htmlFor='fusion-prompt'>
                  {t('Custom Synthesis Prompt (Optional)')}
                </Label>
                <Textarea
                  id='fusion-prompt'
                  rows={3}
                  value={synthesisPrompt}
                  onChange={(e) => setSynthesisPrompt(e.target.value)}
                  placeholder={t(
                    'Instructions for the judge on how to compare and synthesize the candidate answers.'
                  )}
                />
              </div>
            </div>
          )}

          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1'>
            <div className='space-y-1.5'>
              <Label htmlFor='combo-group'>
                {t('Group Binding (Optional)')}
              </Label>
              <Input
                id='combo-group'
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder={t('Leave blank for all groups')}
              />
            </div>

            <div className='flex items-center justify-between border rounded-md p-3'>
              <div className='space-y-0.5'>
                <Label htmlFor='combo-status' className='cursor-pointer'>
                  {t('Enable Combo')}
                </Label>
                <p className='text-xs text-muted-foreground'>
                  {status === 1 ? t('Active') : t('Disabled')}
                </p>
              </div>
              <Switch
                id='combo-status'
                checked={status === 1}
                onCheckedChange={(checked) => setStatus(checked ? 1 : 2)}
              />
            </div>
          </div>

          <DialogFooter className='pt-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button type='submit' disabled={isSubmitting}>
              {isSubmitting ? t('Saving...') : t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
