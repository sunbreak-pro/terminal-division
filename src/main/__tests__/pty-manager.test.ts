import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// モック関数をvi.hoisted()で定義してホイスト問題を回避
const { mockOnData, mockOnExit, mockWrite, mockResize, mockKill, mockSpawn, mockSend, mockIsDestroyed } = vi.hoisted(() => ({
  mockOnData: vi.fn(),
  mockOnExit: vi.fn(),
  mockWrite: vi.fn(),
  mockResize: vi.fn(),
  mockKill: vi.fn(),
  mockSpawn: vi.fn(),
  mockSend: vi.fn(),
  mockIsDestroyed: vi.fn().mockReturnValue(false)
}))

// node-ptyモック
vi.mock('node-pty', () => ({
  spawn: mockSpawn.mockReturnValue({
    onData: mockOnData,
    onExit: mockOnExit,
    write: mockWrite,
    resize: mockResize,
    kill: mockKill
  })
}))

// Electronモック
vi.mock('electron', () => ({
  BrowserWindow: vi.fn()
}))

// osモック
vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/Users/test')
}))

// テスト対象をインポート
import { ptyManager } from '../pty-manager'

describe('pty-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // モックBrowserWindowを設定
    const mockWindow = {
      webContents: { send: mockSend },
      isDestroyed: mockIsDestroyed
    }
    ptyManager.setMainWindow(mockWindow as unknown as Electron.BrowserWindow)
  })

  afterEach(() => {
    // 全PTYプロセスをクリーンアップ
    ptyManager.killAll()
  })

  describe('createPty', () => {
    it('should create a new PTY process', () => {
      const result = ptyManager.createPty('test-pty-1')

      expect(result).toBe(true)
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String), // shell
        [],
        expect.objectContaining({
          encoding: 'utf8',
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: '/Users/test'
        })
      )
    })

    it('should return false for duplicate id', () => {
      ptyManager.createPty('test-pty-2')
      const result = ptyManager.createPty('test-pty-2')

      expect(result).toBe(false)
    })

    it('should set up onData listener', () => {
      ptyManager.createPty('test-pty-3')

      expect(mockOnData).toHaveBeenCalled()

      // onDataコールバックをシミュレート
      const onDataCallback = mockOnData.mock.calls[0][0]
      onDataCallback('test output')

      expect(mockSend).toHaveBeenCalledWith('pty:data', {
        id: 'test-pty-3',
        data: 'test output'
      })
    })

    it('should set up onExit listener', () => {
      ptyManager.createPty('test-pty-4')

      expect(mockOnExit).toHaveBeenCalled()

      // onExitコールバックをシミュレート
      const onExitCallback = mockOnExit.mock.calls[0][0]
      onExitCallback({ exitCode: 0 })

      expect(mockSend).toHaveBeenCalledWith('pty:exit', {
        id: 'test-pty-4',
        exitCode: 0
      })
    })

    it('should filter npm_ environment variables', () => {
      // npm_config_prefix などがフィルタされることを確認
      process.env.npm_test_var = 'should-be-filtered'
      process.env.NORMAL_VAR = 'should-exist'

      ptyManager.createPty('test-pty-filter')

      const spawnCall = mockSpawn.mock.calls[0]
      const envArg = spawnCall[2].env

      expect(envArg.npm_test_var).toBeUndefined()
      expect(envArg.LANG).toBe('ja_JP.UTF-8')

      delete process.env.npm_test_var
      delete process.env.NORMAL_VAR
    })
  })

  describe('write', () => {
    it('should write small data directly', () => {
      ptyManager.createPty('test-write-1')
      ptyManager.write('test-write-1', 'hello')

      expect(mockWrite).toHaveBeenCalledWith('hello')
    })

    it('should do nothing for non-existent id', () => {
      mockWrite.mockClear()
      ptyManager.write('non-existent', 'data')

      // write should not be called
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('should use chunked write for large data', async () => {
      ptyManager.createPty('test-write-large')

      // 512バイト以上のデータ
      const largeData = 'x'.repeat(600)
      ptyManager.write('test-write-large', largeData)

      // ブラケットペースト開始が書き込まれる
      expect(mockWrite).toHaveBeenCalledWith('\x1b[200~')
    })
  })

  describe('resize', () => {
    it('should resize PTY', () => {
      ptyManager.createPty('test-resize')
      ptyManager.resize('test-resize', 120, 40)

      expect(mockResize).toHaveBeenCalledWith(120, 40)
    })

    it('should do nothing for non-existent id', () => {
      mockResize.mockClear()
      ptyManager.resize('non-existent', 100, 30)

      expect(mockResize).not.toHaveBeenCalled()
    })
  })

  describe('kill', () => {
    it('should kill PTY process', () => {
      ptyManager.createPty('test-kill')
      ptyManager.kill('test-kill')

      expect(mockKill).toHaveBeenCalled()
    })

    it('should remove PTY from processes map', () => {
      ptyManager.createPty('test-kill-2')
      ptyManager.kill('test-kill-2')

      // 同じIDで再作成できるはず
      const result = ptyManager.createPty('test-kill-2')
      expect(result).toBe(true)
    })

    it('should do nothing for non-existent id', () => {
      mockKill.mockClear()
      ptyManager.kill('non-existent')

      expect(mockKill).not.toHaveBeenCalled()
    })
  })

  describe('killAll', () => {
    it('should kill all PTY processes', () => {
      ptyManager.createPty('test-all-1')
      ptyManager.createPty('test-all-2')
      ptyManager.createPty('test-all-3')

      mockKill.mockClear()
      ptyManager.killAll()

      expect(mockKill).toHaveBeenCalledTimes(3)
    })
  })

  describe('sendToRenderer', () => {
    it('should not send if window is destroyed', () => {
      mockIsDestroyed.mockReturnValue(true)
      mockSend.mockClear()
      ptyManager.createPty('test-destroyed')

      // onDataコールバックをシミュレート
      const onDataCallback = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0]
      onDataCallback('test')

      // mockSendは呼ばれないはず
      expect(mockSend).not.toHaveBeenCalled()
      mockIsDestroyed.mockReturnValue(false)
    })

    it('should not send if window is null', () => {
      ptyManager.setMainWindow(null as unknown as Electron.BrowserWindow)
      mockSend.mockClear()
      ptyManager.createPty('test-null-window')

      const onDataCallback = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0]
      onDataCallback('test')

      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
