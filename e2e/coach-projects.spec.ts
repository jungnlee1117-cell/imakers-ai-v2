import { expect, test } from '@playwright/test'

async function createProject(page: import('@playwright/test').Page, childText: string, offset: number) {
  await page.goto('/')
  await page.getByRole('button', { name: '그림 그리기 시작하기' }).click()
  const canvas = page.getByLabel('그림 그리기 캔버스')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas bounds are unavailable')
  await page.mouse.move(box.x + 130, box.y + 120 + offset)
  await page.mouse.down()
  await page.mouse.move(box.x + 420, box.y + 260 - offset, { steps: 12 })
  await page.mouse.up()
  await page.getByRole('button', { name: /완료하고 AI에게 보여주기/ }).first().click()
  await expect(page.locator('.coach-response p:not(.muted)')).toBeVisible({ timeout: 5_000 })
  await page.locator('#child-reply').fill(childText)
  await page.locator('.send-button').click()
  await expect(page.locator('.typing')).toBeVisible()
  await expect(page.locator('.typing')).toBeHidden({ timeout: 5_000 })
  return page.locator('.coach-response p').innerText()
}

test('pig, spaceship and robot projects receive different contextual coaching', async ({ page }) => {
  const pig = await createProject(page, '친쿵나테 가는 돼지야', 0)
  const spaceship = await createProject(page, '달에서 아이스크림 파는 우주선', 35)
  const robot = await createProject(page, '친구가 내 장난감을 가져갔어', 70)

  expect(pig).not.toContain('친쿵나테')
  expect(pig).toMatch(/돼지.*친구|친구.*돼지/)
  expect(spaceship).toMatch(/달.*아이스크림|아이스크림.*달/)
  expect(robot).toMatch(/속상|화가|마음/)
  expect(robot).not.toMatch(/어디|장소|지나/)
  expect(new Set([pig, spaceship, robot]).size).toBe(3)
})
