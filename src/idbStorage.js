// Gerenciador de cache local de alta performance com IndexedDB
// Permite guardar centenas de megabytes de catálogo e carregar em < 50ms sem travar a interface

const DB_NAME = 'pxt_player_catalog_cache_v1'
const DB_VERSION = 1
const STORE_NAME = 'catalogs'

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB não suportado neste navegador'))
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getCachedCatalog(key) {
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => resolve(null)
    })
  } catch (err) {
    console.warn('[IDB CACHE] Leitura falhou:', err?.message || err)
    return null
  }
}

export async function setCachedCatalog(key, value) {
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    })
  } catch (err) {
    console.warn('[IDB CACHE] Gravação falhou:', err?.message || err)
    return false
  }
}

export async function clearCachedCatalog(key) {
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete(key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    })
  } catch (err) {
    return false
  }
}
