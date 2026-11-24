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
import { Loader2, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import { testEmail } from '../api'
import type { TestEmailRequest } from '../types'
import type { EmailFormValues } from './email-settings-schema'

type TestEmailDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  formValues: EmailFormValues
}

export function TestEmailDialog({
  open,
  onOpenChange,
  formValues,
}: TestEmailDialogProps) {
  const { t } = useTranslation()
  const userEmail = useAuthStore((state) => state.user?.email)
  const [recipient, setRecipient] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (open) {
      setRecipient(userEmail || '')
    }
  }, [open, userEmail])

  const handleSend = async () => {
    const trimmed = recipient.trim()
    if (!trimmed) {
      toast.error(t('Recipient email address is required'))
      return
    }

    setIsSending(true)
    try {
      let resendFrom = formValues.ResendFrom?.trim()
      if (formValues.ResendSenderName?.trim() && resendFrom) {
        const escapedName = formValues.ResendSenderName.trim()
          .replaceAll('\\', '\\\\')
          .replaceAll('"', '\\"')
        resendFrom = `"${escapedName}" <${resendFrom}>`
      }

      const payload: TestEmailRequest = {
        recipient: trimmed,
        EmailProvider: formValues.EmailProvider,
        SMTPServer: formValues.SMTPServer?.trim(),
        SMTPPort: formValues.SMTPPort?.trim(),
        SMTPAccount: formValues.SMTPAccount?.trim(),
        SMTPFrom: formValues.SMTPFrom?.trim(),
        SMTPToken: formValues.SMTPToken?.trim() || undefined,
        SMTPSSLEnabled: formValues.SMTPSSLEnabled,
        SMTPStartTLSEnabled: formValues.SMTPStartTLSEnabled,
        SMTPInsecureSkipVerify: formValues.SMTPInsecureSkipVerify,
        SMTPForceAuthLogin: formValues.SMTPForceAuthLogin,
        ResendApiKey: formValues.ResendApiKey?.trim() || undefined,
        ResendFrom: resendFrom,
      }

      const res = await testEmail(payload)
      if (res.success) {
        toast.success(t('Test email sent successfully'))
        onOpenChange(false)
      } else {
        toast.error(res.message || t('Failed to send test email'))
      }
    } catch (error) {
      handleServerError(error)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={isSending ? undefined : onOpenChange}
      title={t('Test Email')}
      description={t(
        'Send a test email to verify your email service configuration.'
      )}
      footer={
        <div className='flex w-full items-center justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            onClick={handleSend}
            disabled={isSending || !recipient.trim()}
          >
            {isSending ? (
              <>
                <Loader2 data-icon='inline-start' className='animate-spin' />
                <span>{t('Sending...')}</span>
              </>
            ) : (
              <>
                <Send data-icon='inline-start' />
                <span>{t('Send Test Email')}</span>
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className='grid gap-4 py-2'>
        <div className='grid gap-2'>
          <Label htmlFor='test-email-recipient'>{t('Recipient Email')}</Label>
          <Input
            id='test-email-recipient'
            type='email'
            placeholder='admin@example.com'
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={isSending}
            autoComplete='email'
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleSend()
              }
            }}
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          {t(
            'The test email will be sent using the current form configuration (including unsaved draft changes).'
          )}
        </p>
      </div>
    </Dialog>
  )
}
