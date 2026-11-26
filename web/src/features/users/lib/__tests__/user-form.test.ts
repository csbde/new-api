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
import { expect, it } from 'vitest'

import {
  transformFormDataToPayload,
  USER_FORM_DEFAULT_VALUES,
} from '../user-form'

it('includes selected user group in create payload and falls back to default', () => {
  const withGroup = transformFormDataToPayload({
    ...USER_FORM_DEFAULT_VALUES,
    username: 'alice',
    password: 'password123',
    group: 'vip',
  })
  expect(withGroup.group).toBe('vip')

  const withEmptyGroup = transformFormDataToPayload({
    ...USER_FORM_DEFAULT_VALUES,
    username: 'bob',
    password: 'password123',
    group: '',
  })
  expect(withEmptyGroup.group).toBe('default')
})
