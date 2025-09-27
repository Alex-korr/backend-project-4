/* eslint-env browser */
console.log('Runtime script loaded from Hexlet!')

// Some runtime initialization

if (typeof window !== 'undefined') {
  window.HexletRuntime = {
    version: '1.0.0',
    init: function () {
      console.log('Hexlet runtime initialized')
    },
  }
}
