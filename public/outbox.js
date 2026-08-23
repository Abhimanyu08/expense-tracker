/* Durable hand-off between the service worker and the app.
 *
 * A share can arrive while the session is expired or the device is offline, so
 * the SW never uploads directly -- it parks the file here and the app drains
 * the queue once it knows who is logged in. Classic script on purpose: the SW
 * pulls it in with importScripts and index.html loads the same file, so both
 * sides share one implementation. */
;(function (global) {
  var DB = 'kharcha'
  var STORE = 'outbox'
  var VERSION = 1

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = function () {
        var db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        }
      }
      req.onsuccess = function () {
        resolve(req.result)
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode)
        var out = fn(t.objectStore(STORE))
        t.oncomplete = function () {
          db.close()
          resolve(out && out.result)
        }
        t.onerror = function () {
          db.close()
          reject(t.error)
        }
        t.onabort = function () {
          db.close()
          reject(t.error)
        }
      })
    })
  }

  global.Outbox = {
    add: function (record) {
      return tx('readwrite', function (s) {
        return s.add(record)
      })
    },
    all: function () {
      return tx('readonly', function (s) {
        return s.getAll()
      })
    },
    remove: function (id) {
      return tx('readwrite', function (s) {
        return s.delete(id)
      })
    },
  }
})(self)
