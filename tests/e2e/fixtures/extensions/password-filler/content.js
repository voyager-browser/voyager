;(() => {
  if (document.getElementById('voyager-e2e-extension')) return
  const marker = document.createElement('div')
  marker.id = 'voyager-e2e-extension'
  marker.textContent = 'password-filler-ready'
  marker.style.display = 'none'
  ;(document.body ?? document.documentElement).appendChild(marker)
})()
