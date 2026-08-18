import { expect, test } from '@playwright/test'

const envelope = (data: unknown) => ({ data, request_id: 'req_test' })

test('connected settings, spaces, profile, AI and Markdown preview are functional', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Connected workflow is covered once at desktop width.')

  const user = { id: 'usr_1', username: 'lzc', display_name: '云端用户', bio: '云端签名' }
  const initialSpace = { id: 'spc_1', name: '个人空间', role: 'owner' }
  const markdownDocument = {
    id: 'doc_1',
    title: 'Markdown 示例',
    mime_type: 'text/markdown',
    status: 'ready',
    page_count: null,
    chunk_count: 2,
    tags: [],
    local_path: 'knowledge-files\\example.md',
    updated_at: '2026-08-14T02:00:00Z',
  }
  const cloudDocuments = [markdownDocument]

  await page.route('**/api/v1/auth/login', async (route) => {
    await route.fulfill({ json: envelope({ user, access_token: 'token', refresh_token: 'refresh', expires_in: 3600 }) })
  })
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({ json: envelope({ user, spaces: [initialSpace] }) })
  })
  await page.route('**/api/v1/spaces/*/notes?*', async (route) => {
    await route.fulfill({ json: envelope({ items: [], next_cursor: null }) })
  })
  await page.route('**/api/v1/spaces/*/documents?*', async (route) => {
    await route.fulfill({ json: envelope({ items: cloudDocuments, next_cursor: null }) })
  })
  await page.route('**/api/v1/spaces/*/todos?*', async (route) => {
    await route.fulfill({ json: envelope({ items: [] }) })
  })
  await page.route('**/api/v1/spaces/*/archive', async (route) => {
    await route.fulfill({ json: envelope({ folders: [], items: [] }) })
  })
  await page.route('**/api/v1/spaces/*/documents', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const uploaded = {
      ...markdownDocument,
      id: 'doc_2',
      title: '新上传文档',
      status: 'queued' as const,
      local_path: 'knowledge-files\\new-upload.md',
      updated_at: new Date().toISOString(),
    }
    cloudDocuments.unshift(uploaded)
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({ status: 202, json: envelope({
      document: uploaded,
      job: { id: 'job_2', status: 'queued' },
    }) })
  })
  await page.route('**/api/v1/spaces', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: envelope({ id: 'spc_2', name: '工作知识库', role: 'owner' }) })
      return
    }
    await route.fallback()
  })
  await page.route('**/api/v1/spaces/spc_2', async (route) => {
    const body = route.request().postDataJSON() as { name: string }
    await route.fulfill({ json: envelope({ id: 'spc_2', name: body.name, role: 'owner' }) })
  })
  await page.route('**/api/v1/auth/profile', async (route) => {
    const body = route.request().postDataJSON() as { display_name: string; bio: string }
    await route.fulfill({ json: envelope({ ...user, display_name: body.display_name, bio: body.bio }) })
  })
  await page.route('**/api/v1/spaces/*/notes', async (route) => {
    const body = route.request().postDataJSON() as { id: string; title: string; content: string; collection: string }
    expect(body.collection).toBe('项目备忘')
    await route.fulfill({ json: envelope({
      id: body.id,
      space_id: 'spc_2',
      title: body.title,
      content: body.content,
      collection: body.collection,
      favorite: false,
      revision: 1,
      created_at: '2026-08-14T02:00:00Z',
      updated_at: '2026-08-14T02:00:00Z',
    }) })
  })
  await page.route('**/api/v1/ai/chat', async (route) => {
    const body = route.request().postDataJSON() as { base_url: string; model: string; prompt: string }
    expect(body.base_url).toBe('http://model.test/v1')
    expect(body.model).toBe('test-model')
    await route.fulfill({ json: envelope({ answer: body.prompt.includes('连接成功') ? '连接成功' : '这是真实模型接口的回复', model: 'test-model', reference_count: 1 }) })
  })
  await page.route('**/api/v1/documents/doc_1/content', async (route) => {
    await route.fulfill({ json: envelope({
      content: '## 渲染标题\n\n| 字段 | 值 |\n| --- | --- |\n| 类型 | Markdown |\n\n![示例图](https://assets.test/example.png)',
      mime_type: 'text/markdown',
      updated_at: '2026-08-14T02:00:00Z',
    }) })
  })
  await page.route('**/api/v1/documents/doc_2/content', async (route) => {
    await route.fulfill({ json: envelope({
      content: '# 新上传文档\n\n上传内容。',
      mime_type: 'text/markdown',
      updated_at: new Date().toISOString(),
    }) })
  })
  await page.route('https://assets.test/example.png', async (route) => {
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  })

  await page.goto('/')
  await page.getByLabel('用户名').fill('lzc')
  await page.getByLabel('密码').fill('password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '你好，云端用户' })).toBeVisible()

  await expect(page.getByRole('button', { name: '上传', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导出', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '添加知识空间' }).click()
  await page.getByPlaceholder('例如：工作知识库').fill('工作知识库')
  await page.getByRole('button', { name: '创建空间' }).click()
  await expect(page.getByRole('button', { name: /工作知识库/ })).toBeVisible()

  await page.getByRole('button', { name: '添加分类' }).click()
  await page.getByPlaceholder('例如：项目备忘').fill('项目备忘')
  await page.getByRole('button', { name: '创建分类' }).click()
  await expect(page.getByRole('button', { name: /项目备忘/ })).toBeVisible()

  await page.locator('.new-note').click()
  await page.getByPlaceholder('输入标题').fill('已登录笔记')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('笔记应先保存到本机。')
  await page.getByRole('button', { name: '保存笔记' }).click()
  await expect(page.getByText('已登录笔记')).toBeVisible()

  await page.getByRole('button', { name: '个人资料' }).click()
  await expect(page.locator('.profile-page')).toBeVisible()
  await expect(page.locator('.profile-modal')).toHaveCount(0)
  await page.getByLabel('显示名称').fill('新云端名称')
  await page.getByLabel('知识空间名称').fill('工作空间')
  await page.getByLabel('个人签名').fill('已同步签名')
  await page.getByRole('button', { name: '保存资料' }).click()
  await expect(page.locator('.profile-page').getByText('新云端名称')).toBeVisible()

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.locator('.settings-modal')
  await expect(settings.getByRole('tab', { name: '账号' })).toHaveAttribute('aria-selected', 'true')
  await expect(settings.getByText('已连接', { exact: true })).toBeVisible()
  await expect(settings.locator('.account-setting-rows').getByText('lzc', { exact: true })).toBeVisible()
  await expect(settings.getByText('工作空间', { exact: true })).toBeVisible()
  await settings.getByRole('tab', { name: 'AI 模型' }).click()
  await page.getByLabel('服务 URL').fill('http://model.test/v1')
  await page.getByLabel('API Key').fill('test-key')
  await page.getByLabel('模型', { exact: true }).fill('test-model')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('模型 test-model 连接成功')).toBeVisible()
  await page.getByRole('button', { name: '保存设置' }).click()

  await page.getByPlaceholder('问问你的知识库…').fill('总结我的笔记')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('这是真实模型接口的回复')).toBeVisible()

  await page.getByRole('button', { name: '知识库文件' }).click()
  await expect(page.getByText('Markdown 示例')).toBeVisible()
  await page.locator('.cloud-file-section .document-row').filter({ hasText: 'Markdown 示例' }).locator('.document-actions').getByTitle('查看云端解析内容').click()
  await expect(page.getByRole('heading', { name: '渲染标题' })).toBeVisible()
  await expect(page.locator('.markdown-body table')).toBeVisible()
  await expect(page.locator('.markdown-body img[alt="示例图"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('connected-markdown-preview.png'), fullPage: true })
  await page.locator('.document-preview').getByRole('button', { name: '知识库文件' }).click()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '保存到知识库' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'new-upload.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 新上传文档\n\n上传内容。'),
  })
  await expect(page.locator('.knowledge-reader-page').getByRole('heading', { name: '新上传文档' })).toBeVisible()
  await page.locator('.knowledge-reader-page').getByRole('button', { name: '知识库文件' }).click()
  await expect(page.locator('.local-document-list .document-row').filter({ hasText: 'new-upload.md' })).toBeVisible()
})

test('a signed-in note saves locally before a cloud space exists', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The no-space local-first path is covered once at desktop width.')
  const user = { id: 'usr_local', username: 'local-first', display_name: '本地优先用户', bio: '' }
  let cloudCreateCalls = 0

  await page.route('**/api/v1/auth/login', (route) => route.fulfill({
    json: envelope({ user, access_token: 'token', refresh_token: 'refresh', expires_in: 3600 }),
  }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope({ user, spaces: [] }) }))
  await page.route('**/api/v1/spaces/*/notes', async (route) => {
    cloudCreateCalls += 1
    await route.fulfill({ status: 500, json: { error: { message: '不应调用云端' } } })
  })

  await page.goto('/')
  await page.getByLabel('用户名').fill('local-first')
  await page.getByLabel('密码').fill('password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.locator('.new-note').click()
  await page.getByPlaceholder('输入标题').fill('无空间本地笔记')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('即使没有知识空间也必须先写入本机。')
  await page.getByRole('button', { name: '保存笔记' }).click()

  await expect(page.getByText('无空间本地笔记')).toBeVisible()
  await expect(page.getByText('已保存到本机，创建知识空间后可同步')).toBeVisible()
  await page.locator('.side-nav').getByRole('button', { name: /草稿箱/ }).click()
  await expect(page.getByText('无空间本地笔记')).toBeVisible()
  expect(cloudCreateCalls).toBe(0)
})
