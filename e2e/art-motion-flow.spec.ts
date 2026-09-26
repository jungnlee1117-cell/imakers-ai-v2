import { expect, test } from '@playwright/test'

test('draws with tactile tools and hides unreleased motion objects', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '그림 그리기 시작하기' }).click()

  const canvas = page.getByLabel('그림 그리기 캔버스')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas bounds are unavailable')

  const tools = ['연필', '크레파스', '사인펜', '붓']
  for (let index = 0; index < tools.length; index += 1) {
    const tool = page.locator('.material-dock').getByRole('button', { name: tools[index], exact: true })
    await tool.click()
    await expect(tool).toHaveClass(/active/)
    const y = box.y + 120 + index * 42
    await page.mouse.move(box.x + 150, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 460, y, { steps: 14 })
    await page.mouse.up()
  }

  const thick = page.getByRole('button', { name: '굵게', exact: true })
  await thick.click()
  await expect(thick).toHaveClass(/active/)

  await page.getByRole('button', { name: '지우개', exact: true }).click()
  for (const size of ['작게', '중간', '크게']) {
    const sizeButton = page.getByRole('button', { name: size, exact: true })
    await sizeButton.click()
    await expect(sizeButton).toHaveClass(/active/)
  }

  const undo = page.getByRole('button', { name: '되돌리기' })
  const redo = page.getByRole('button', { name: '다시 실행' })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(redo).toBeEnabled()
  await redo.click()

  await page.getByRole('button', { name: '전체 지우기' }).click()
  await expect(undo).toBeEnabled()
  await undo.click()

  await page.getByRole('button', { name: /완료하고 AI에게 보여주기/ }).click()
  await expect(page.getByText('같이 상상하는 메이')).toBeVisible()
  await expect(page.locator('.observing')).toBeHidden({ timeout: 5_000 })
  await expect(page.locator('.coach-response p:not(.muted)')).toBeVisible()

  const reply = page.locator('#child-reply')
  for (const answer of ['공룡 자동차야', '엄마를 구하러 가', '용암 길을 지나가', '얼음 바퀴로 달려']) {
    await reply.fill(answer)
    await page.locator('.send-button').click()
    await expect(page.locator('.typing')).toBeVisible()
    await expect(page.locator('.typing')).toBeHidden({ timeout: 5_000 })
  }

  await page.getByRole('button', { name: /응, 같이 만들어보자/ }).click()
  await expect(page.getByText('어디를 바꾸고 싶어?')).toBeVisible()
  await expect(page.locator('.image-loading')).toBeHidden({ timeout: 5_000 })

  await expect(page.getByText('움직임 기능 준비 중')).toBeVisible()
  await expect(page.getByRole('button', { name: /내 그림 움직여보기/ })).toHaveCount(0)
  await expect(page.getByText('하늘과 구름')).toHaveCount(0)
  await expect(page.getByText('배경의 특별한 곳')).toHaveCount(0)
})
