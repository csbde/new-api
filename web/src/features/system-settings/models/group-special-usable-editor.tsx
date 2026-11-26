/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const sectionCardClassName = 'min-w-0 shadow-none'
const sectionHeaderClassName = 'gap-2 border-b'
const EXCLUSIVE_USABLE_GROUP_KEY = '*:exclusive'

type Rule = {
  _id: string
  userGroup: string
  visible: boolean
  targetGroup: string
  description: string
}

let _idCounter = 0
function uid() {
  return `gsu_${++_idCounter}`
}

// Raw keys use +: (add), -: (remove), or no prefix (also add).
// The UI collapses this to visible/hidden and serializes visible rules
// with the +: prefix, which the backend treats identically to no prefix.
function parseRawKey(rawKey: string): { visible: boolean; groupName: string } {
  if (rawKey.startsWith('-:')) {
    return { visible: false, groupName: rawKey.slice(2) }
  }
  if (rawKey.startsWith('+:')) {
    return { visible: true, groupName: rawKey.slice(2) }
  }
  return { visible: true, groupName: rawKey }
}

function toRawKey(visible: boolean, groupName: string): string {
  return visible ? `+:${groupName}` : `-:${groupName}`
}

function safeParseJson(str: string): Record<string, Record<string, string>> {
  if (!str || !str.trim()) return {}
  try {
    return JSON.parse(str) as Record<string, Record<string, string>>
  } catch {
    return {}
  }
}

function extractExclusiveGroups(
  nested: Record<string, Record<string, string>>
): Set<string> {
  const exclusive = new Set<string>()
  for (const [userGroup, inner] of Object.entries(nested)) {
    if (typeof inner !== 'object' || inner === null) continue
    if (Object.hasOwn(inner, EXCLUSIVE_USABLE_GROUP_KEY)) {
      exclusive.add(userGroup)
    }
  }
  return exclusive
}

function flattenRules(nested: Record<string, Record<string, string>>): Rule[] {
  const rules: Rule[] = []
  for (const [userGroup, inner] of Object.entries(nested)) {
    if (typeof inner !== 'object' || inner === null) continue
    for (const [rawKey, desc] of Object.entries(inner)) {
      if (rawKey === EXCLUSIVE_USABLE_GROUP_KEY) continue
      const { visible, groupName } = parseRawKey(rawKey)
      let description = ''
      if (!visible) {
        description = 'remove'
      } else if (typeof desc === 'string') {
        description = desc
      }
      rules.push({
        _id: uid(),
        userGroup,
        visible,
        targetGroup: groupName,
        description,
      })
    }
  }
  return rules
}

function serializeRules(
  rules: Rule[],
  exclusiveGroups: ReadonlySet<string>
): string {
  const result: Record<string, Record<string, string>> = {}
  for (const userGroup of exclusiveGroups) {
    if (!userGroup) continue
    result[userGroup] = { [EXCLUSIVE_USABLE_GROUP_KEY]: '1' }
  }
  for (const { userGroup, visible, targetGroup, description } of rules) {
    if (!userGroup || !targetGroup) continue
    if (!result[userGroup]) result[userGroup] = {}
    result[userGroup][toRawKey(visible, targetGroup)] = description
  }
  return Object.keys(result).length === 0
    ? '{}'
    : JSON.stringify(result, null, 2)
}

function computeEffectiveGroups(
  userGroup: string,
  exclusive: boolean,
  items: Rule[],
  globalUsableGroups: string[]
): string[] {
  const visibleSet = new Set<string>(exclusive ? [] : globalUsableGroups)
  let explicitlyRemovedSelf = false
  for (const rule of items) {
    if (!rule.targetGroup) continue
    if (rule.visible) {
      visibleSet.add(rule.targetGroup)
      if (rule.targetGroup === userGroup) explicitlyRemovedSelf = false
    } else {
      visibleSet.delete(rule.targetGroup)
      if (rule.targetGroup === userGroup) explicitlyRemovedSelf = true
    }
  }
  if (userGroup && !explicitlyRemovedSelf) {
    visibleSet.add(userGroup)
  }
  return [...visibleSet]
}

type GroupSelectProps = {
  options: string[]
  value: string
  placeholder: string
  onValueChange: (value: string) => void
  className?: string
}

function GroupSelect(props: GroupSelectProps) {
  const knownOptions = useMemo(() => {
    if (props.value && !props.options.includes(props.value)) {
      return [props.value, ...props.options]
    }
    return props.options
  }, [props.options, props.value])

  return (
    <Combobox
      options={knownOptions.map((name) => ({ value: name, label: name }))}
      value={props.value}
      onValueChange={(value) => {
        if (value) props.onValueChange(value)
      }}
      className={props.className}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
    />
  )
}

type GroupSpecialUsableRulesEditorProps = {
  value: string
  groupOptions: string[]
  userUsableGroups?: string
  onChange: (value: string) => void
}

type GroupSectionProps = {
  groupName: string
  items: Rule[]
  exclusive: boolean
  globalUsableGroups: string[]
  groupOptions: string[]
  onToggleExclusive: (groupName: string, exclusive: boolean) => void
  onUpdate: (id: string, field: keyof Rule, val: string | boolean) => void
  onRemove: (id: string) => void
  onAdd: (groupName: string) => void
  onRemoveGroup: (groupName: string) => void
}

function GroupSection(props: GroupSectionProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const isKnownGroup = props.groupOptions.includes(props.groupName)
  const effectiveGroups = useMemo(
    () =>
      computeEffectiveGroups(
        props.groupName,
        props.exclusive,
        props.items,
        props.globalUsableGroups
      ),
    [props.groupName, props.exclusive, props.items, props.globalUsableGroups]
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className='rounded-lg border'>
        <div className='flex items-center justify-between gap-2 p-3'>
          <CollapsibleTrigger
            render={
              <Button
                variant='ghost'
                className='h-auto min-w-0 justify-start whitespace-normal'
              />
            }
            aria-label={t('Rules for {{group}}', { group: props.groupName })}
          >
            {open ? (
              <ChevronUp className='h-4 w-4' />
            ) : (
              <ChevronDown className='h-4 w-4' />
            )}
            <span className='min-w-0 truncate font-semibold'>
              {props.groupName}
            </span>
            {!isKnownGroup && (
              <StatusBadge variant='danger' copyable={false}>
                <AlertTriangle className='mr-1 h-3 w-3' />
                {t('Not in pricing table')}
              </StatusBadge>
            )}
            <StatusBadge variant='neutral' copyable={false}>
              {props.items.length} {t('rules')}
            </StatusBadge>
          </CollapsibleTrigger>
          <div className='flex shrink-0 items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 w-7 p-0'
              aria-label={t('Add rule')}
              onClick={() => {
                props.onAdd(props.groupName)
                setOpen(true)
              }}
            >
              <Plus className='h-4 w-4' />
            </Button>
            <Button
              variant='ghost'
              size='sm'
              className='text-destructive h-7 w-7 p-0'
              aria-label={t('Remove {{group}}', { group: props.groupName })}
              onClick={() => props.onRemoveGroup(props.groupName)}
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          </div>
        </div>
        <CollapsibleContent>
          <div className='space-y-3 border-t p-3'>
            <div className='bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-md px-2.5 py-2'>
              <span className='text-muted-foreground text-xs font-medium'>
                {t('Visibility mode')}
              </span>
              <Select
                value={props.exclusive ? 'exclusive' : 'inherit'}
                onValueChange={(v) =>
                  v !== null &&
                  props.onToggleExclusive(props.groupName, v === 'exclusive')
                }
              >
                <SelectTrigger
                  className='h-8 w-full sm:w-64'
                  aria-label={t('Visibility mode for {{group}}', {
                    group: props.groupName,
                  })}
                >
                  <SelectValue>
                    {props.exclusive
                      ? t('Whitelist only (own group + rules)')
                      : t('Inherit global + rules')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectItem value='inherit'>
                      {t('Inherit global + rules')}
                    </SelectItem>
                    <SelectItem value='exclusive'>
                      {t('Whitelist only (own group + rules)')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {props.items.map((rule) => (
              <div
                key={rule._id}
                className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-3 sm:grid-cols-[130px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:border-0 sm:p-0'
              >
                <Select
                  value={rule.visible ? 'visible' : 'hidden'}
                  onValueChange={(v) =>
                    v !== null &&
                    props.onUpdate(rule._id, 'visible', v === 'visible')
                  }
                >
                  <SelectTrigger
                    className='w-full sm:w-[130px]'
                    aria-label={t('Group visibility')}
                  >
                    <SelectValue>
                      <StatusBadge
                        label={rule.visible ? t('Extra visible') : t('Hidden')}
                        variant={rule.visible ? 'info' : 'danger'}
                        copyable={false}
                      />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='visible'>
                        <StatusBadge
                          label={t('Extra visible')}
                          variant='info'
                          copyable={false}
                        />
                      </SelectItem>
                      <SelectItem value='hidden'>
                        <StatusBadge
                          label={t('Hidden')}
                          variant='danger'
                          copyable={false}
                        />
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className='col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 sm:col-start-auto sm:row-start-auto'>
                  <GroupSelect
                    className='min-w-0 flex-1'
                    options={props.groupOptions}
                    value={rule.targetGroup}
                    placeholder={t('Group name')}
                    onValueChange={(v) =>
                      props.onUpdate(rule._id, 'targetGroup', v)
                    }
                  />
                  {rule.targetGroup &&
                    !props.groupOptions.includes(rule.targetGroup) && (
                      <AlertTriangle
                        className='text-destructive h-4 w-4 shrink-0'
                        aria-label={t('Not in pricing table')}
                      />
                    )}
                </div>
                {rule.visible ? (
                  <Input
                    className='col-start-1 row-start-3 min-w-0 sm:col-start-auto sm:row-start-auto'
                    aria-label={t('Description')}
                    value={rule.description}
                    placeholder={t('Description')}
                    onChange={(e) =>
                      props.onUpdate(rule._id, 'description', e.target.value)
                    }
                  />
                ) : (
                  <div className='text-muted-foreground hidden px-3 text-sm sm:block'>
                    -
                  </div>
                )}
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive col-start-2 row-start-1 size-8 p-0 sm:col-start-auto sm:row-start-auto'
                  aria-label={t('Delete rule')}
                  onClick={() => props.onRemove(rule._id)}
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            ))}
            <div className='flex flex-wrap items-center gap-1.5 border-t pt-2.5'>
              <span className='text-muted-foreground text-xs'>
                {t('Effective visible groups')}:
              </span>
              {effectiveGroups.length === 0 ? (
                <span className='text-muted-foreground text-xs'>
                  {t('None')}
                </span>
              ) : (
                effectiveGroups.map((group) => (
                  <StatusBadge
                    key={group}
                    label={group}
                    variant='neutral'
                    copyable={false}
                  />
                ))
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function GroupSpecialUsableRulesEditor(
  props: GroupSpecialUsableRulesEditorProps
) {
  const { t } = useTranslation()
  const [rules, setRules] = useState<Rule[]>(() =>
    flattenRules(safeParseJson(props.value))
  )
  const [exclusiveGroups, setExclusiveGroups] = useState<Set<string>>(() =>
    extractExclusiveGroups(safeParseJson(props.value))
  )

  const globalUsableGroups = useMemo(() => {
    if (!props.userUsableGroups) return []
    try {
      const parsed = JSON.parse(props.userUsableGroups) as unknown
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.keys(parsed)
      }
    } catch {
      /* ignore invalid JSON */
    }
    return []
  }, [props.userUsableGroups])

  const { onChange } = props
  const emitChange = useCallback(
    (newRules: Rule[], nextExclusive: Set<string> = exclusiveGroups) => {
      setRules(newRules)
      setExclusiveGroups(nextExclusive)
      onChange(serializeRules(newRules, nextExclusive))
    },
    [onChange, exclusiveGroups]
  )

  const toggleExclusive = useCallback(
    (groupName: string, exclusive: boolean) => {
      const next = new Set(exclusiveGroups)
      if (exclusive) {
        next.add(groupName)
      } else {
        next.delete(groupName)
      }
      emitChange(rules, next)
    },
    [exclusiveGroups, rules, emitChange]
  )

  const updateRule = useCallback(
    (id: string, field: keyof Rule, val: string | boolean) => {
      emitChange(
        rules.map((r) => {
          if (r._id !== id) return r
          const updated = { ...r, [field]: val }
          if (field === 'visible' && val === false) {
            updated.description = 'remove'
          } else if (field === 'visible' && val === true && !r.visible) {
            if (updated.description === 'remove') updated.description = ''
          }
          return updated
        })
      )
    },
    [rules, emitChange]
  )

  const removeRule = useCallback(
    (id: string) => emitChange(rules.filter((r) => r._id !== id)),
    [rules, emitChange]
  )

  const removeGroup = useCallback(
    (groupName: string) => {
      const next = new Set(exclusiveGroups)
      next.delete(groupName)
      emitChange(
        rules.filter((r) => r.userGroup !== groupName),
        next
      )
    },
    [rules, exclusiveGroups, emitChange]
  )

  const addRuleToGroup = useCallback(
    (groupName: string) => {
      emitChange([
        ...rules,
        {
          _id: uid(),
          userGroup: groupName,
          visible: true,
          targetGroup: '',
          description: '',
        },
      ])
    },
    [rules, emitChange]
  )

  const grouped = useMemo(() => {
    const map: Record<string, Rule[]> = {}
    const order: string[] = []
    for (const groupName of exclusiveGroups) {
      if (!groupName) continue
      map[groupName] = []
      order.push(groupName)
    }
    for (const r of rules) {
      if (!r.userGroup) continue
      if (!map[r.userGroup]) {
        map[r.userGroup] = []
        order.push(r.userGroup)
      }
      map[r.userGroup].push(r)
    }
    return order.map((name) => ({ name, items: map[name] }))
  }, [rules, exclusiveGroups])

  const newGroupCandidates = useMemo(() => {
    const used = new Set(grouped.map((g) => g.name))
    return props.groupOptions.filter((name) => !used.has(name))
  }, [grouped, props.groupOptions])

  return (
    <Card className={sectionCardClassName}>
      <CardHeader className={sectionHeaderClassName}>
        <CardTitle>{t('Special usable group rules')}</CardTitle>
        <CardDescription>
          {t(
            'Make extra groups visible to, or hide default groups from, users of a specific group.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className='space-y-3'>
          {grouped.length === 0 ? (
            <EmptyState
              className='min-h-40'
              title={t('No rules yet. Add a group below to get started.')}
            />
          ) : (
            grouped.map((group) => (
              <GroupSection
                key={group.name}
                groupName={group.name}
                items={group.items}
                exclusive={exclusiveGroups.has(group.name)}
                globalUsableGroups={globalUsableGroups}
                groupOptions={props.groupOptions}
                onToggleExclusive={toggleExclusive}
                onUpdate={updateRule}
                onRemove={removeRule}
                onAdd={addRuleToGroup}
                onRemoveGroup={removeGroup}
              />
            ))
          )}

          <div className='flex items-center justify-center pt-2'>
            <GroupSelect
              className='w-full sm:w-72'
              options={newGroupCandidates}
              value=''
              placeholder={t('Add rules for a user group')}
              onValueChange={addRuleToGroup}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
