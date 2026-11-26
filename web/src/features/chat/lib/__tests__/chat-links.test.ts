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

import { resolveChatUrl } from '../chat-links'

function decodePayload(url: string, prefix: string) {
  const encoded = url.slice(prefix.length)
  return JSON.parse(atob(decodeURIComponent(encoded)))
}

it('encodes cherryConfig, aionuiConfig, and deepchatConfig with neutral aigateway identifier', () => {
  const cherry = resolveChatUrl({
    template: 'cherrystudio://providers/api-keys?v=1&data={cherryConfig}',
    apiKey: 'test-key',
    serverAddress: 'https://api.example.com',
  })
  expect(
    decodePayload(cherry, 'cherrystudio://providers/api-keys?v=1&data=')
  ).toEqual({
    id: 'aigateway',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key',
  })

  const aionui = resolveChatUrl({
    template: 'aionui://provider/add?v=1&data={aionuiConfig}',
    apiKey: 'test-key',
    serverAddress: 'https://api.example.com',
  })
  expect(decodePayload(aionui, 'aionui://provider/add?v=1&data=')).toEqual({
    platform: 'aigateway',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key',
  })

  const deepchat = resolveChatUrl({
    template: 'deepchat://start?data={deepchatConfig}',
    apiKey: 'test-key',
    serverAddress: 'https://api.example.com',
  })
  expect(decodePayload(deepchat, 'deepchat://start?data=')).toEqual({
    id: 'aigateway',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key',
  })
})
