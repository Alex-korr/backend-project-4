#!/usr/bin/env node

// Simple script to check if we can run tests
import { spawn } from 'child_process'

console.log('Starting test coverage check...')

// Set environment variables
process.env.NODE_ENV = 'test'

// Run the coverage test
const testProcess = spawn('npx', ['c8', '--reporter=text', '--lines', '80', '--functions', '80', '--branches', '80', '--statements', '80', 'node', '--experimental-vm-modules', 'node_modules/.bin/jest'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' },
})

testProcess.on('close', (code) => {
  console.log(`Test process exited with code ${code}`)
  if (code === 0) {
    console.log('✅ All tests passed and coverage requirements met!')
  }
  else {
    console.log('❌ Tests failed or coverage requirements not met')
  }
  process.exit(code)
})

testProcess.on('error', (error) => {
  console.error('Failed to start test process:', error)
  process.exit(1)
})
