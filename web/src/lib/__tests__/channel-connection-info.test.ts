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
  CHANNEL_CONNECTION_INFO_TYPE,
  encodeChannelConnectionInfo,
  parseChannelConnectionInfo,
} from '../channel-connection-info'

it('encodes channel connection info with the neutral channel_conn type', () => {
  const encoded = encodeChannelConnectionInfo(
    'sk-test',
    'https://api.example.com'
  )
  expect(JSON.parse(encoded)).toEqual({
    _type: 'channel_conn',
    key: 'sk-test',
    url: 'https://api.example.com',
  })
  expect(CHANNEL_CONNECTION_INFO_TYPE).toBe('channel_conn')
})

it('parses both neutral and legacy connection info payloads', () => {
  expect(
    parseChannelConnectionInfo(
      JSON.stringify({
        _type: 'channel_conn',
        key: 'sk-neutral',
        url: 'https://neutral.example.com',
      })
    )
  ).toEqual({
    key: 'sk-neutral',
    url: 'https://neutral.example.com',
  })

  expect(
    parseChannelConnectionInfo(
      JSON.stringify({
        _type: 'newapi_channel_conn',
        key: 'sk-legacy',
        url: 'https://legacy.example.com',
      })
    )
  ).toEqual({
    key: 'sk-legacy',
    url: 'https://legacy.example.com',
  })
})
