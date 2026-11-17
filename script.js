(function () {
  'use strict'

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Footer year.
  var year = document.getElementById('year')
  if (year) year.textContent = String(new Date().getFullYear())

  // Mobile navigation.
  var toggle = document.getElementById('nav-toggle')
  var nav = document.getElementById('site-nav')

  function setNavOpen(open) {
    if (!toggle || !nav) return
    nav.classList.toggle('is-open', open)
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation')
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      setNavOpen(toggle.getAttribute('aria-expanded') !== 'true')
    })

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setNavOpen(false)
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setNavOpen(false)
    })

    document.addEventListener('click', function (event) {
      if (!nav.contains(event.target) && !toggle.contains(event.target)) setNavOpen(false)
    })
  }

  // Reveal content as it scrolls into view.
  var revealItems = Array.prototype.slice.call(document.querySelectorAll('.reveal'))

  if (!('IntersectionObserver' in window)) {
    revealItems.forEach(function (item) {
      item.classList.add('is-visible')
    })
  } else {
    var revealObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )

    revealItems.forEach(function (item) {
      revealObserver.observe(item)
    })
  }

  // Highlight the section that matches the visible content.
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.site-nav a[href^="#"]'))
  var sections = navLinks
    .map(function (link) {
      return document.querySelector(link.getAttribute('href'))
    })
    .filter(Boolean)

  if ('IntersectionObserver' in window && sections.length) {
    var sectionObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          navLinks.forEach(function (link) {
            var isActive = link.getAttribute('href') === '#' + entry.target.id
            link.classList.toggle('is-active', isActive)
            if (isActive) link.setAttribute('aria-current', 'true')
            else link.removeAttribute('aria-current')
          })
        })
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: 0 }
    )

    sections.forEach(function (section) {
      sectionObserver.observe(section)
    })
  }

  // Animate the dashboard example number once it becomes visible.
  var counter = document.querySelector('[data-count]')

  function runCounter(element) {
    var target = parseInt(element.getAttribute('data-count'), 10)
    if (!isFinite(target)) return

    if (reduceMotion) {
      element.textContent = target.toLocaleString()
      return
    }

    var duration = 1400
    var start = null

    function frame(timestamp) {
      if (start === null) start = timestamp
      var progress = Math.min((timestamp - start) / duration, 1)
      var eased = 1 - Math.pow(1 - progress, 3)
      element.textContent = Math.round(target * eased).toLocaleString()
      if (progress < 1) window.requestAnimationFrame(frame)
    }

    window.requestAnimationFrame(frame)
  }

  if (counter) {
    if (!('IntersectionObserver' in window)) {
      runCounter(counter)
    } else {
      var counterObserver = new IntersectionObserver(
        function (entries, observer) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return
            runCounter(entry.target)
            observer.unobserve(entry.target)
          })
        },
        { threshold: 0.4 }
      )
      counterObserver.observe(counter)
    }
  }
})()
