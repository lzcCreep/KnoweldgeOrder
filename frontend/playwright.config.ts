import { defineConfig, devices } from '@playwright/test'

const storedLocalProfile = JSON.stringify({
  username: 'local',
  displayName: '测试用户',
  bio: '',
  spaceName: '个人空间',
})

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://127.0.0.1:4173',
        localStorage: [{ name: 'zhixu-profile', value: storedLocalProfile }],
      }],
    },
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1365, height: 900 } },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-landscape-chrome',
      use: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
