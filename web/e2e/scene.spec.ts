import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { analyzeScenePixels } from '../src/lib/scenePixels'

const WEBGL_TEST_TIMEOUT = 180_000

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

test('renders live telemetry and a nonblank 3D scene without panel overlap', async ({ page }) => {
  test.setTimeout(WEBGL_TEST_TIMEOUT)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')

  const hud = page.locator('.hud-panel')
  const controls = page.locator('.scene-controls')
  // Workspaces lazy-load their 3D chunks: allow time for the chunk fetch,
  // mission config, and first WebSocket frames on cold servers.
  await expect(hud).toContainText('Shenzhen UAV Patrol Demo', { timeout: 60_000 })
  await expect(hud).toContainText('Online')
  await expect(hud).toContainText('uav-001')
  await expect(hud).toContainText('Online: 3', { timeout: 60_000 })
  await expect(controls).toBeVisible()

  const canvas = page.locator('.cesium-widget canvas')
  await expect(canvas).toBeVisible()
  await expectWebGLContext(canvas)
  const cesiumLogo = page.locator('.cesium-credit-logoContainer')
  await expect(cesiumLogo).toBeVisible()
  await expect(cesiumLogo.locator('img')).toHaveAttribute('src', /cesium_credit\.png$/)
  await expect(page.locator('.cesium-credit-textContainer')).toBeHidden()
  await expect(page.locator('.cesium-credit-expand-link')).toBeHidden()
  const [canvasBox, hudBox, controlsBox] = await Promise.all([
    canvas.boundingBox(),
    hud.boundingBox(),
    controls.boundingBox(),
  ])
  expect(canvasBox).not.toBeNull()
  expect(hudBox).not.toBeNull()
  expect(controlsBox).not.toBeNull()
  expect(rectanglesOverlap(hudBox!, controlsBox!)).toBe(false)
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const sceneClip = {
    x: Math.floor(viewport!.width * 0.38),
    y: Math.floor(viewport!.height * 0.48),
    width: Math.floor(viewport!.width * 0.24),
    height: Math.floor(viewport!.height * 0.16),
  }
  await page.waitForTimeout(1_500)
  const chaseFrame = await captureVisibleScene(page, sceneClip)
  await controls.getByRole('button', { name: /Top-down view/ }).click()
  await expect(controls.getByRole('button', { name: /Top-down view/ })).toHaveCSS('font-weight', '700')
  await page.waitForTimeout(1_500)
  const topFrame = await captureVisibleScene(page, sceneClip)
  expect(imageDifference(chaseFrame, topFrame)).toBeGreaterThan(8)
  expect(pageErrors).toEqual([])
})

test('switches to the Cesium and Three.js digital twin workspace with working controls', async ({ page }) => {
  test.setTimeout(WEBGL_TEST_TIMEOUT)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')

  await page.getByRole('button', { name: 'Digital Twin' }).click()
  await expect(page).toHaveURL(/project=digital-twin/)
  await expect(page.getByRole('heading', { name: 'Campus assets' })).toBeVisible({ timeout: 60_000 })

  const cesiumCanvas = page.locator('.twin-scene .cesium-widget canvas')
  const threeCanvas = page.locator('.three-twin-layer canvas')
  await expect(cesiumCanvas).toBeVisible()
  await expect(threeCanvas).toBeVisible()
  await expectWebGLContext(cesiumCanvas)
  await expectWebGLContext(threeCanvas)
  await expect(page.getByText('CESIUM', { exact: true })).toBeAttached()
  await expect(page.getByText('THREE.JS', { exact: true })).toBeAttached()

  const viewport = page.viewportSize()!
  if (viewport.width <= 860) {
    await page.getByRole('button', { name: 'Open asset catalog' }).click()
  }
  await page.getByRole('button', { name: /Low-Altitude Comms Tower/ }).click()
  await expect(page.getByText('COM-E05', { exact: true }).last()).toBeVisible()

  const pauseButton = page.getByRole('button', { name: 'Pause simulation' })
  await pauseButton.click()
  await expect(page.getByRole('button', { name: 'Resume simulation' })).toBeVisible()

  const canvasRegion = {
    x: Math.floor(viewport.width * 0.34),
    y: Math.floor(viewport.height * 0.36),
    width: Math.max(80, Math.floor(viewport.width * 0.32)),
    height: Math.max(80, Math.floor(viewport.height * 0.28)),
  }
  await page.waitForTimeout(1_500)
  await captureVisibleScene(page, canvasRegion)
  expect(pageErrors).toEqual([])

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Campus assets' })).toBeVisible({ timeout: 60_000 })
})

async function captureVisibleScene(page: Page, clip: Rect): Promise<Buffer> {
  const frame = await page.screenshot({ clip, animations: 'disabled' })
  const image = PNG.sync.read(frame)
  const analysis = analyzeScenePixels(image.data, image.width, image.height)
  expect(analysis.visible, `scene pixel analysis: ${JSON.stringify(analysis)}`).toBe(true)
  return frame
}

async function expectWebGLContext(canvas: ReturnType<Page['locator']>): Promise<void> {
  const contextAvailable = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('webgl2') ?? target.getContext('webgl')
    return Boolean(context && !context.isContextLost())
  })
  expect(contextAvailable).toBe(true)
}

function rectanglesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function imageDifference(firstBuffer: Buffer, secondBuffer: Buffer): number {
  const first = PNG.sync.read(firstBuffer)
  const second = PNG.sync.read(secondBuffer)
  if (first.width !== second.width || first.height !== second.height) return Number.POSITIVE_INFINITY

  let difference = 0
  for (let index = 0; index < first.data.length; index += 4) {
    difference += Math.abs(first.data[index] - second.data[index])
    difference += Math.abs(first.data[index + 1] - second.data[index + 1])
    difference += Math.abs(first.data[index + 2] - second.data[index + 2])
  }
  return difference / (first.width * first.height * 3)
}
