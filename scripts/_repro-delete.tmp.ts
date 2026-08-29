import 'fake-indexeddb/auto'
import { useAppStore } from '../src/store'
import { db } from '../src/db'

async function main() {
  const store = useAppStore.getState()
  await store.init()

  const folder = await useAppStore.getState().addFolder('Minha Pasta')
  console.log('folder created:', folder.id, folder.name)

  const nb = await useAppStore.getState().createNotebook('Minha Nota', folder.id, 'blank')
  console.log('notebook created:', nb.id, nb.name)

  console.log('--- before delete ---')
  console.log('folders:', useAppStore.getState().folders.length)
  console.log('notebooks:', useAppStore.getState().notebooks.length)

  await useAppStore.getState().deleteNotebook(nb.id, 'local')
  console.log('notebook deleted')
  await useAppStore.getState().deleteFolder(folder.id, 'local')
  console.log('folder deleted')

  console.log('--- after delete ---')
  console.log('folders:', useAppStore.getState().folders.length)
  console.log('notebooks:', useAppStore.getState().notebooks.length)
  console.log('trash:', useAppStore.getState().trash.length)
  console.log('db notebooks:', (await db.getNotebooks()).length)
  console.log('db folders:', (await db.getFolders()).length)
  console.log('db trash:', (await db.getTrash()).length)
}

main().then(() => {
  console.log('OK')
  process.exit(0)
}).catch((e) => {
  console.error('ERROR:', e)
  process.exit(1)
})
