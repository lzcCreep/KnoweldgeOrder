import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
})

test('login and registration entry stay compact', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-landscape-chrome', 'Portrait and desktop cover the compact auth layout.')

  await page.goto('/')
  const panel = page.locator('.login-panel')
  const registerEntry = page.getByRole('button', { name: '注册', exact: true })
  await expect(registerEntry).toBeVisible()
  expect((await panel.boundingBox())?.width).toBeLessThanOrEqual(360)
  expect((await registerEntry.boundingBox())?.height).toBeLessThanOrEqual(24)

  await registerEntry.click()
  await expect(page.getByRole('heading', { name: '创建云端账户' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-compact-register.png`), fullPage: true })
})

test('first local entry asks for a name once', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('zhixu-profile'))
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()

  const dialog = page.getByRole('dialog', { name: '设置本地名称' })
  await expect(dialog).toBeVisible()
  expect((await dialog.boundingBox())?.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-first-local-profile.png`), fullPage: true })
  await page.getByRole('textbox', { name: '怎么称呼你' }).fill('小知')
  await dialog.getByRole('button', { name: '进入知识库' }).click()

  await expect(page.getByRole('heading', { name: '你好，小知' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('zhixu-profile') || '{}').displayName)).toBe('小知')

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '你好，小知' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})

test('offline note workflow remains usable', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  if (testInfo.project.name.startsWith('mobile-')) {
    await page.addInitScript(() => {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    })
  }
  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()

  await expect(page.getByRole('heading', { name: /你好/ })).toBeVisible()
  const mobile = testInfo.project.name.startsWith('mobile-')
  if (mobile) {
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(page.locator('.assistant-panel')).toHaveCount(0)
  } else {
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.assistant-panel')).toBeVisible()
  }

  await page.getByRole('button', { name: '添加今日待办' }).click()
  await page.getByPlaceholder('输入今天要完成的事项').fill('检查今日任务')
  await page.getByRole('button', { name: '添加待办' }).click()
  await expect(page.locator('.todo-item').getByText('检查今日任务', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑待办：检查今日任务' }).click()
  await page.getByPlaceholder('输入今天要完成的事项').fill('检查今日任务（已编辑）')
  await page.getByRole('button', { name: '保存修改' }).click()
  await page.getByRole('button', { name: '完成待办：检查今日任务（已编辑）' }).click()
  await expect(page.locator('.todo-item.completed').getByText('检查今日任务（已编辑）', { exact: true })).toBeVisible()

  if (await page.locator('.mobile-add').isVisible()) await page.locator('.mobile-add').click()
  else if (mobile) await page.getByRole('button', { name: '记录想法' }).click()
  else await page.locator('.new-note').click()
  await expect(page.locator('.note-editor-page')).toBeVisible()
  await expect(page.locator('.editor-modal')).toHaveCount(0)
  await page.getByPlaceholder('输入标题').fill('手机离线笔记')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('这是一条在手机窄屏上创建并保存在本机的测试笔记。')
  await page.getByRole('button', { name: '保存笔记' }).click()

  await expect(page.getByRole('heading', { name: '手机离线笔记', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '今日待办' })).toBeVisible()
  await expect(page.locator('.note-row .note-sync-state')).toHaveText('未同步到云端')
  await page.locator('.note-row').filter({ hasText: '手机离线笔记' }).click()
  await expect(page.locator('.detail-backdrop')).toHaveCount(0)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByPlaceholder('输入标题').fill('手机离线笔记（已编辑）')
  if (mobile) await page.setViewportSize({ width: 320, height: 720 })
  const editorActionBoxes = await Promise.all(['删除', '取消', '保存笔记'].map((name) => page.locator('.note-editor-actions').getByRole('button', { name, exact: true }).boundingBox()))
  expect(Math.max(...editorActionBoxes.map((box) => box?.y || 0)) - Math.min(...editorActionBoxes.map((box) => box?.y || 0))).toBeLessThanOrEqual(1)
  if (mobile) await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-320-editor-actions.png`), fullPage: true })
  await page.getByRole('button', { name: '保存笔记' }).click()

  await page.locator('.note-row').filter({ hasText: '手机离线笔记（已编辑）' }).click()
  const detail = page.locator('.note-detail')
  await expect(page.locator('.content-scroll > .note-detail')).toBeVisible()
  await detail.getByRole('button', { name: '收藏' }).click()
  await expect(detail.getByRole('button', { name: '收藏' }).locator('svg')).toHaveAttribute('fill', 'currentColor')
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-note-detail.png`), fullPage: true })

  page.once('dialog', (dialog) => dialog.accept())
  await detail.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('手机离线笔记（已编辑）')).toHaveCount(0)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除待办：检查今日任务（已编辑）' }).click()
  await expect(page.getByText('检查今日任务（已编辑）', { exact: true })).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('notes render Markdown inline while typing', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  if (await page.locator('.mobile-add').isVisible()) await page.locator('.mobile-add').click()
  else if (testInfo.project.name.startsWith('mobile-')) await page.getByRole('button', { name: '记录想法' }).click()
  else await page.locator('.new-note').click()
  await page.getByPlaceholder('输入标题').fill('Markdown 实时笔记')

  const editor = page.getByRole('textbox', { name: 'editable markdown' })
  const source = () => editor.evaluate((element) => element.textContent || '')

  await editor.pressSequentially('***你好***')
  await expect(editor.locator('strong')).toHaveText('你好')
  await editor.press('Backspace')
  await expect.poll(source).toBe('***你好**')

  await editor.press('Control+a')
  await editor.pressSequentially('**你好***')
  await editor.press('Home')
  await editor.pressSequentially('*')
  await expect.poll(source).toBe('***你好***')
  await expect(editor.locator('strong')).toHaveText('你好')

  await editor.press('End')
  await editor.pressSequentially('\n\n这是普通文本。')
  await expect.poll(async () => editor.locator('.vditor-ir__marker').evaluateAll((markers) => (
    markers.length > 0 && markers.every((marker) => marker.getBoundingClientRect().width === 0)
  ))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-inline-markdown-editor.png`), fullPage: true })

  await page.getByRole('button', { name: '保存笔记' }).click()
  await page.locator('.note-row').filter({ hasText: 'Markdown 实时笔记' }).click()
  const detail = page.locator('.note-detail')
  await expect(detail.locator('.markdown-body strong')).toHaveText('你好')
})

test('leaving a note editor asks whether to save before navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The full navigation decision flow only needs one desktop run.')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await page.locator('.new-note').click()
  await page.getByPlaceholder('输入标题').fill('暂不保存的笔记')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('这段内容仍在编辑。')

  await page.locator('.side-nav').getByRole('button', { name: '收藏', exact: true }).click()
  const prompt = page.getByRole('alertdialog', { name: '笔记尚未保存' })
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: '继续编辑' }).click()
  await expect(page.locator('.note-editor-page')).toBeVisible()

  await page.locator('.side-nav').getByRole('button', { name: '收藏', exact: true }).click()
  await prompt.getByRole('button', { name: '不保存' }).click()
  await expect(page.getByRole('heading', { name: '收藏', exact: true })).toBeVisible()
  await expect(page.getByText('暂不保存的笔记', { exact: true })).toHaveCount(0)

  await page.locator('.new-note').click()
  await page.getByPlaceholder('输入标题').fill('导航前保存的笔记')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('保存成功后再进入全部笔记。')
  await page.locator('.side-nav').getByRole('button', { name: /全部笔记/ }).click()
  await prompt.getByRole('button', { name: '保存并前往' }).click()
  await expect(page.getByRole('heading', { name: '全部笔记', exact: true })).toBeVisible()
  await expect(page.locator('.note-row').filter({ hasText: '导航前保存的笔记' })).toBeVisible()
})

test('markdown editor supports heading, table, and code shortcuts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard shortcuts only need one desktop run.')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await page.locator('.new-note').click()

  const editor = page.getByRole('textbox', { name: 'editable markdown' })
  const source = () => editor.evaluate((element) => element.textContent || '')
  await editor.pressSequentially('一级标题')
  await editor.press('Control+1')
  await expect(editor.locator('h1')).toContainText('一级标题')
  await expect.poll(source).toBe('# 一级标题')

  await editor.press('Control+a')
  await editor.press('Backspace')
  await editor.press('Control+m')
  await expect(editor.locator('table')).toBeVisible()

  await editor.press('Control+a')
  await editor.press('Backspace')
  await editor.press('Control+u')
  await expect.poll(source).toContain('```')
  await expect(page.getByRole('button', { name: /代码块 <Ctrl\+U>/ })).toBeVisible()
})

test('desktop AI panel resizes horizontally and remembers its width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop-only split panel behavior')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()

  const panel = page.locator('.assistant-panel')
  const handle = page.getByRole('separator', { name: '调整 AI 窗口宽度' })
  const initial = await panel.boundingBox()
  const handleBox = await handle.boundingBox()
  expect(initial).not.toBeNull()
  expect(handleBox).not.toBeNull()

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + 120)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x - 100, handleBox!.y + 120, { steps: 5 })
  await page.mouse.up()

  const resized = await panel.boundingBox()
  expect(resized).not.toBeNull()
  expect(resized!.width).toBeGreaterThan(initial!.width + 80)
  const savedWidth = await page.evaluate(() => Number(localStorage.getItem('zhixu-assistant-width')))
  expect(savedWidth).toBeCloseTo(resized!.width, 0)

  await page.reload()
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  const restored = await page.locator('.assistant-panel').boundingBox()
  expect(restored).not.toBeNull()
  expect(restored!.width).toBeCloseTo(savedWidth, 0)
})

test('version notification opens release notes and marks them as read', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()

  const notification = page.getByRole('button', { name: '版本更新' })
  await expect(notification).toHaveClass(/has-update/)
  await notification.click()

  const releaseDialog = page.getByRole('dialog', { name: '版本更新' })
  await expect(releaseDialog).toBeVisible()
  await expect(releaseDialog.getByText('v0.1.0', { exact: true })).toBeVisible()
  await expect(releaseDialog.getByText('笔记工作流', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('desktop-release-notes.png'), fullPage: true })
  await releaseDialog.getByRole('button', { name: '知道了' }).click()
  await expect(releaseDialog).toHaveCount(0)
  await expect(notification).not.toHaveClass(/has-update/)
})

test('local and cloud settings tabs fit responsive screens', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile-'), 'Responsive settings coverage only runs on mobile viewports.')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await page.getByRole('button', { name: '打开菜单' }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()

  const settings = page.locator('.settings-modal')
  await expect(settings.getByRole('tab', { name: '账号' })).toHaveAttribute('aria-selected', 'true')
  await expect(settings.getByText('当前使用本地离线模式', { exact: true })).toBeVisible()
  await settings.getByRole('tab', { name: '通用' }).click()
  await expect(settings.getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true')
  await expect(settings.getByLabel('知识库文件目录')).toBeVisible()
  await settings.getByRole('tab', { name: 'AI 模型' }).click()
  const modelTest = settings.getByRole('button', { name: '测试连接' })
  await expect(modelTest).toBeVisible()
  const modelButtonBox = await modelTest.boundingBox()
  expect(modelButtonBox?.height).toBeLessThanOrEqual(36)
  await expect(settings.getByLabel('服务 URL')).toHaveCSS('font-size', '11px')
  await expect(modelTest).toHaveCSS('font-size', '11px')
  await settings.getByRole('tab', { name: '通知' }).click()
  const updateNotifications = settings.getByLabel('版本更新提醒')
  await expect(updateNotifications).toBeChecked()
  await updateNotifications.uncheck()
  await expect(page.getByRole('button', { name: '版本更新', exact: true })).toHaveCount(0)
  await updateNotifications.check()
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-settings-cloud.png`), fullPage: true })
  await settings.getByRole('tab', { name: '关于' }).click()
  await expect(settings.getByText('v0.1.0', { exact: true })).toBeVisible()

  const overflow = await settings.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('appearance setting themes the whole application and persists', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Theme persistence and desktop framework styling only need one desktop run.')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await expect(page.locator('.brand-row')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '配置 AI 模型' })).toHaveCount(0)

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.locator('.settings-modal')
  await settings.getByRole('tab', { name: '通用' }).click()
  await expect(settings.getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true')
  await settings.getByRole('radio', { name: '浅色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await settings.getByRole('radio', { name: '跟随系统' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await settings.getByRole('radio', { name: '深色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 26, 24)')
  await expect(settings).toHaveCSS('background-color', 'rgb(32, 37, 33)')
  await page.screenshot({ path: testInfo.outputPath('desktop-dark-appearance.png'), fullPage: true })
  await settings.getByRole('button', { name: '保存设置' }).click()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.login-page')).toHaveCSS('background-color', 'rgb(23, 26, 24)')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.settings-modal').getByRole('tab', { name: '通用' }).click()
  await expect(page.getByRole('radio', { name: '深色' })).toHaveAttribute('aria-checked', 'true')
})

test('offline knowledge files persist and edit in the main page', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.startsWith('mobile-')

  await page.addInitScript(() => {
    const originalGetItem = Storage.prototype.getItem
    let scanCount = 0
    Storage.prototype.getItem = function (key: string) {
      if (key === 'zhixu-knowledge-files-v1') scanCount += 1
      return originalGetItem.call(this, key)
    }
    Object.defineProperty(window, '__knowledgeScanCount', { get: () => scanCount })
  })

  const openSidebar = async () => {
    const mobileSpace = page.locator('.mobile-nav').getByRole('button', { name: '空间', exact: true })
    if (await mobileSpace.isVisible()) {
      await mobileSpace.click()
      return
    }
    const menu = page.getByRole('button', { name: '打开菜单' })
    if (await menu.isVisible()) await menu.click()
  }

  const openKnowledgeFiles = async () => {
    if (mobile) await openSidebar()
    await page.getByRole('button', { name: '知识库文件' }).click()
  }

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await expect(page.getByRole('button', { name: '上传', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导出', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __knowledgeScanCount: number }).__knowledgeScanCount)).toBe(1)

  if (mobile) await openSidebar()
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()
  await page.getByRole('button', { name: '个人资料' }).click()
  await expect(page.locator('.profile-page')).toBeVisible()
  await expect(page.locator('.profile-modal')).toHaveCount(0)

  await openKnowledgeFiles()
  await expect(page.getByRole('heading', { name: '知识库文件', exact: true })).toBeVisible()
  await expect(page.getByText('knowledge-files', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __knowledgeScanCount: number }).__knowledgeScanCount)).toBe(2)

  await openKnowledgeFiles()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __knowledgeScanCount: number }).__knowledgeScanCount)).toBe(3)

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '保存到知识库' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'offline-library.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 离线知识标题\n\n- 第一项\n- 第二项'),
  })

  const reader = page.locator('.knowledge-reader-page')
  await expect(reader.getByRole('heading', { name: '离线知识标题' })).toBeVisible()
  await reader.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel('编辑文件：offline-library.md').fill('# 修改后的标题\n\n内容已经写回本地。')
  await reader.getByRole('button', { name: '保存文件' }).click()
  await expect(reader.getByRole('heading', { name: '修改后的标题' })).toBeVisible()
  await reader.getByRole('button', { name: '知识库文件' }).click()
  await expect(page.locator('.local-document-list .document-row').filter({ hasText: 'offline-library.md' })).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __knowledgeScanCount: number }).__knowledgeScanCount)).toBe(1)
  if (mobile) await openSidebar()
  const filesNavigation = page.locator('.side-nav').getByRole('button', { name: /知识库文件/ })
  await expect(filesNavigation.locator('small')).toHaveText('1')
  await filesNavigation.click()
  const storedRow = page.locator('.local-document-list .document-row').filter({ hasText: 'offline-library.md' })
  await expect(storedRow).toBeVisible()
  await storedRow.getByRole('button', { name: /offline-library\.md/ }).click()
  await expect(page.locator('.knowledge-reader-page').getByRole('heading', { name: '修改后的标题' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-knowledge-file.png`), fullPage: true })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('offline profile saves locally and survives reload', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.startsWith('mobile-')

  const openProfile = async () => {
    if (mobile) {
      const mobileSpace = page.locator('.mobile-nav').getByRole('button', { name: '空间', exact: true })
      if (await mobileSpace.isVisible()) await mobileSpace.click()
      else await page.getByRole('button', { name: '打开菜单' }).click()
    }
    await page.getByRole('button', { name: '个人资料' }).click()
  }

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await openProfile()

  await page.getByLabel('用户名').fill('local-user')
  await page.getByLabel('显示名称').fill('本地用户')
  await page.getByLabel('知识空间名称').fill('本地资料空间')
  await page.getByLabel('个人签名').fill('只保存在当前设备。')
  await page.getByRole('button', { name: '保存资料' }).click()

  await expect(page.getByRole('status')).toHaveText('个人资料已保存到本机')
  await expect(page.locator('.profile-overview').getByText('本地用户', { exact: true })).toBeVisible()
  await expect(page.locator('.profile-overview')).toContainText('@local-user · 本地资料空间')

  await page.reload()
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await openProfile()

  await expect(page.getByLabel('用户名')).toHaveValue('local-user')
  await expect(page.getByLabel('显示名称')).toHaveValue('本地用户')
  await expect(page.getByLabel('知识空间名称')).toHaveValue('本地资料空间')
  await expect(page.getByLabel('个人签名')).toHaveValue('只保存在当前设备。')
})

test('sidebar counts stay accurate and hide zero values', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The sidebar count behavior only needs one desktop run.')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()

  for (const title of ['第一条本地笔记', '第二条本地笔记']) {
    await page.locator('.new-note').click()
    await page.getByPlaceholder('输入标题').fill(title)
    await page.getByRole('button', { name: '保存笔记' }).click()
  }

  const allNotes = page.locator('.side-nav').getByRole('button', { name: /全部笔记/ })
  const drafts = page.locator('.side-nav').getByRole('button', { name: /草稿箱/ })
  const files = page.locator('.side-nav').getByRole('button', { name: /知识库文件/ })
  const favorites = page.locator('.side-nav').getByRole('button', { name: /收藏/ })
  await expect(allNotes.locator('small')).toHaveText('2')
  await expect(drafts.locator('small')).toHaveText('2')
  await expect(files.locator('small')).toHaveCount(0)
  await expect(favorites.locator('small')).toHaveCount(0)
  await page.getByRole('button', { name: '收藏：第一条本地笔记' }).click()
  await expect(favorites.locator('small')).toHaveText('1')
  await favorites.click()
  await expect(page.getByRole('heading', { name: '收藏', exact: true })).toBeVisible()
  await expect(page.getByText('第一条本地笔记', { exact: true })).toBeVisible()
  await expect(allNotes.locator('small')).toHaveText('2')

  await files.click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '保存到知识库' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: 'counted-file.md', mimeType: 'text/markdown', buffer: Buffer.from('# counted') })
  await page.locator('.knowledge-reader-page').getByRole('button', { name: '知识库文件' }).click()
  await expect(files.locator('small')).toHaveText('1')
})

test('offline archive folders organize notes and persist state changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The archive workflow only needs one desktop run.')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await page.locator('.side-nav').getByRole('button', { name: '归档', exact: true }).click()
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await page.getByPlaceholder('例如：已完成项目').fill('2026年')
  await page.getByRole('button', { name: '创建目录' }).click()
  const yearFolder = page.locator('.archive-tree-item').filter({ hasText: '2026年' })
  await expect(yearFolder).toBeVisible()
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await page.getByPlaceholder('例如：已完成项目').fill('5月')
  await page.getByRole('button', { name: '创建目录' }).click()
  const monthFolder = page.locator('.archive-tree-item').filter({ hasText: '5月' })
  await expect(monthFolder).toBeVisible()
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await page.getByPlaceholder('例如：已完成项目').fill('工作')
  await page.getByRole('button', { name: '创建目录' }).click()
  const archiveFolder = page.locator('.archive-tree-item').filter({ hasText: '工作' })
  await expect(archiveFolder).toBeVisible()

  await page.locator('.new-note').click()
  await page.getByPlaceholder('输入标题').fill('归档测试笔记')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('这条笔记会保留在原列表，并连接到指定归档目录。')
  await page.getByRole('checkbox', { name: '归档笔记' }).check()
  const archivePicker = page.getByRole('button', { name: '归档目录' })
  await archivePicker.click()
  await expect(page.getByRole('listbox', { name: '归档目录列表' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', { name: '归档目录列表' })).toHaveCount(0)
  await archivePicker.click()
  await page.screenshot({ path: testInfo.outputPath('desktop-archive-folder-picker.png'), fullPage: true })
  await page.getByRole('option').filter({ hasText: '2026年 / 5月 / 工作' }).click()
  await page.getByRole('button', { name: '保存笔记' }).click()

  await expect(page.locator('.archive-items-panel').getByText('归档测试笔记', { exact: true })).toBeVisible()
  await expect(page.locator('.archive-items-panel').getByText('已归档至“2026年 / 5月 / 工作”', { exact: true })).toBeVisible()
  await page.locator('.archive-item-row').filter({ hasText: '归档测试笔记' }).getByRole('button').first().click()
  await expect(page.locator('.note-detail').getByText('已归档至“2026年 / 5月 / 工作”', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回笔记列表' }).click()
  await page.screenshot({ path: testInfo.outputPath('desktop-archive-center.png'), fullPage: true })
  await page.locator('.side-nav').getByRole('button', { name: /全部笔记/ }).click()
  const originalNote = page.locator('.note-row').filter({ hasText: '归档测试笔记' })
  await expect(originalNote).toBeVisible()
  await expect(originalNote.getByText('已归档至“2026年 / 5月 / 工作”', { exact: true })).toBeVisible()

  await page.locator('.side-nav').getByRole('button', { name: '归档', exact: true }).click()
  await archiveFolder.click()
  await page.locator('.archive-item-row').filter({ hasText: '归档测试笔记' }).getByTitle('移出归档').click()
  await expect(page.locator('.archive-items-panel').getByText('归档测试笔记', { exact: true })).toHaveCount(0)
  await page.locator('.side-nav').getByRole('button', { name: /全部笔记/ }).click()
  await expect(page.getByText('归档测试笔记', { exact: true })).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await page.locator('.side-nav').getByRole('button', { name: /全部笔记/ }).click()
  await expect(page.getByText('归档测试笔记', { exact: true })).toBeVisible()
})

test('archived files keep classification, favorite and cloud states as one item', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The full file archive workflow only needs one desktop run.')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()

  await page.getByRole('button', { name: '添加分类' }).click()
  await page.getByPlaceholder('例如：项目备忘').fill('项目材料')
  await page.getByRole('button', { name: '创建分类' }).click()

  await page.locator('.side-nav').getByRole('button', { name: '归档', exact: true }).click()
  for (const name of ['2026年', '5月', '工作']) {
    await page.getByRole('button', { name: '新建目录', exact: true }).click()
    await page.getByPlaceholder('例如：已完成项目').fill(name)
    await page.getByRole('button', { name: '创建目录' }).click()
  }

  await page.locator('.side-nav').getByRole('button', { name: /知识库文件/ }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '保存到知识库' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: 'archive-file.md', mimeType: 'text/markdown', buffer: Buffer.from('# 归档文件\n\n可以从归档目录重新打开。') })

  const reader = page.locator('.knowledge-reader-page')
  await reader.getByLabel('文件分类').selectOption('项目材料')
  await reader.getByRole('button', { name: '收藏', exact: true }).click()
  await reader.getByRole('button', { name: '归档文件', exact: true }).click()
  const archiveDialog = page.locator('.archive-target-modal')
  await archiveDialog.getByRole('button', { name: '归档至' }).click()
  await archiveDialog.getByRole('option').filter({ hasText: '2026年 / 5月 / 工作' }).click()
  await archiveDialog.getByRole('button', { name: '确认归档' }).click()

  await expect(reader.getByText('已归档至“2026年 / 5月 / 工作”', { exact: true })).toBeVisible()
  await expect(reader.getByText('分类：项目材料', { exact: true })).toBeVisible()
  await expect(reader.locator('.content-state.favorite-state')).toHaveText('已收藏')
  await expect(reader.getByText('未同步到云端', { exact: true })).toBeVisible()
  await reader.getByRole('button', { name: '知识库文件' }).click()
  const originalFile = page.locator('.local-document-list').getByText('archive-file.md', { exact: true })
  await expect(originalFile).toBeVisible()

  await page.locator('.side-nav').getByRole('button', { name: '归档', exact: true }).click()
  const archivedRow = page.locator('.archive-item-row').filter({ hasText: 'archive-file.md' })
  await expect(archivedRow).toBeVisible()
  await expect(archivedRow.getByText('分类：项目材料', { exact: true })).toBeVisible()
  await expect(archivedRow.getByText('未同步到云端', { exact: true })).toBeVisible()
  await archivedRow.getByRole('button').first().click()
  await expect(page.locator('.knowledge-reader-page').getByRole('heading', { name: '归档文件' })).toBeVisible()
})

test('a category can be deleted without losing its notes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The category migration path only needs one desktop run.')

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await page.getByRole('button', { name: '添加分类' }).click()
  await page.getByPlaceholder('例如：项目备忘').fill('临时分类')
  await page.getByRole('button', { name: '创建分类' }).click()

  await page.locator('.new-note').click()
  await expect(page.locator('.note-editor-page')).toBeVisible()
  await expect(page.getByLabel('笔记分类')).toHaveValue('临时分类')
  await page.getByPlaceholder('输入标题').fill('分类迁移笔记')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('删除分类后，这条笔记应保留在草稿箱。')
  await page.getByRole('button', { name: '保存笔记' }).click()

  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.collection-delete[title="删除分类：临时分类"]').click()
  await expect(page.locator('.collection-delete[title="删除分类：临时分类"]')).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('分类已删除，1 条笔记已移到草稿箱')
  await page.locator('.side-nav').getByRole('button', { name: /草稿箱/ }).click()
  await expect(page.getByText('分类迁移笔记', { exact: true })).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await expect(page.locator('.collection-delete[title="删除分类：临时分类"]')).toHaveCount(0)
  await page.locator('.side-nav').getByRole('button', { name: /草稿箱/ }).click()
  await expect(page.getByText('分类迁移笔记', { exact: true })).toBeVisible()
})

test('offline AI uses the configured model with local notes and knowledge files', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The direct model path only needs one desktop run.')

  let backendChatCalls = 0
  let directModelCalls = 0
  await page.route('**/api/v1/ai/chat', async (route) => {
    backendChatCalls += 1
    await route.abort()
  })
  await page.route('**/model/v1/chat/completions', async (route) => {
    directModelCalls += 1
    const body = route.request().postDataJSON() as {
      model: string
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe('local-test-model')
    const userMessage = body.messages.find((message) => message.role === 'user')?.content || ''
    const testingConnection = userMessage.includes('连接成功')
    if (!testingConnection) {
      expect(userMessage).toContain('海棠计划')
      expect(userMessage).toContain('周五完成验收')
      expect(userMessage).toContain('local-ai.md')
      expect(userMessage).toContain('蓝桥行动由产品组负责')
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'local-test-model',
        choices: [{ message: { role: 'assistant', content: testingConnection ? '连接成功' : '已结合本机笔记和知识文件回答。' } }],
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()

  await page.locator('.new-note').click()
  await page.getByPlaceholder('输入标题').fill('海棠计划')
  await page.getByRole('textbox', { name: 'editable markdown' }).fill('海棠计划需要在周五完成验收。')
  await page.getByRole('button', { name: '保存笔记' }).click()

  await page.getByRole('button', { name: '知识库文件' }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '保存到知识库' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'local-ai.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 蓝桥行动\n\n蓝桥行动由产品组负责。'),
  })

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.locator('.settings-modal')
  await settings.getByRole('tab', { name: '关于' }).click()
  await expect(settings.getByText('v0.1.0', { exact: true })).toBeVisible()
  await settings.getByRole('tab', { name: 'AI 模型' }).click()
  await page.getByLabel('服务 URL').fill('http://127.0.0.1:4173/model/v1')
  await page.getByLabel('API Key').fill('local-key')
  await page.getByLabel('模型', { exact: true }).fill('local-test-model')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByRole('status')).toHaveText('模型 local-test-model 连接成功')
  await page.getByRole('button', { name: '保存设置' }).click()

  await page.reload()
  await page.getByRole('button', { name: '离线进入本地知识库' }).click()
  await expect(page.getByText('本地上下文模式', { exact: true })).toBeVisible()
  await expect(page.getByText(/不使用云端 RAG 或 MCP/)).toBeVisible()

  await page.getByPlaceholder('问问你的知识库…').fill('海棠计划和蓝桥行动分别是什么？')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('已结合本机笔记和知识文件回答。')).toBeVisible()
  await expect(page.locator('.sources').getByText('本机笔记 · 海棠计划', { exact: true })).toBeVisible()
  await expect(page.locator('.sources').getByText('本地文件 · local-ai.md', { exact: true })).toBeVisible()
  expect(directModelCalls).toBe(2)
  expect(backendChatCalls).toBe(0)
})
