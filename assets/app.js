// ============================================
// Nowarfy / YouToo — Application Logic
// ============================================

class NowarfyApp {
  constructor() {
    this.currentSection = 'home';
    this.isPlaying = false;
    this.currentTrack = null;
    this.audio = new Audio();
    this.init();
  }

  init() {
    this.setupNavigation();
    this.setupPlayer();
    this.setupAudioEvents();
    this.showSection('home');
    console.log('Nowarfy App initialized');
  }

  // --- Navegación con delegación de eventos ---
  setupNavigation() {
    const navLinks = document.querySelector('.nav-links');
    if (navLinks) {
      navLinks.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-nav]');
        if (li) {
          this.handleNav(li.dataset.nav);
        }
      });
    }
  }

  handleNav(section) {
    this.showSection(section);
    
    // Actualizar estado activo
    document.querySelectorAll('.nav-links li').forEach(li => {
      li.classList.remove('active');
    });
    
    const activeLink = document.querySelector(`li[data-nav="${section}"]`);
    if (activeLink) {
      activeLink.classList.add('active');
    }
  }

  showSection(section) {
    this.currentSection = section;
    
    // Ocultar todas las secciones
    document.querySelectorAll('.section').forEach(s => {
      s.classList.remove('active');
    });
    
    // Mostrar la sección objetivo
    const targetSection = document.getElementById(section);
    if (targetSection) {
      targetSection.classList.add('active');
    }
  }

  // --- Player ---
  setupPlayer() {
    const playBtn = document.querySelector('.play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', () => this.togglePlay());
    }

    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.addEventListener('click', (e) => this.seek(e));
    }

    const prevBtn = document.querySelector('.control-btn[title="Anterior"]');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.previousTrack());
    }

    const nextBtn = document.querySelector('.control-btn[title="Siguiente"]');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextTrack());
    }
  }

  setupAudioEvents() {
    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('ended', () => this.onTrackEnd());
    this.audio.addEventListener('loadedmetadata', () => {
      console.log('Track loaded:', this.currentTrack);
    });
  }

  togglePlay() {
    if (!this.currentTrack) {
      console.log('No track selected');
      return;
    }

    this.isPlaying = !this.isPlaying;
    const playBtn = document.querySelector('.play-btn');
    
    if (playBtn) {
      playBtn.innerHTML = this.isPlaying ? '⏸' : '▶';
    }

    if (this.isPlaying) {
      this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  seek(e) {
    if (!this.audio.duration) return;
    
    const progressBar = e.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    this.audio.currentTime = percent * this.audio.duration;
  }

  updateProgress() {
    if (!this.audio.duration) return;
    
    const progressFill = document.querySelector('.progress-fill');
    if (progressFill) {
      const percent = (this.audio.currentTime / this.audio.duration) * 100;
      progressFill.style.width = `${percent}%`;
    }
  }

  loadTrack(track) {
    this.currentTrack = track;
    
    const titleEl = document.querySelector('.track-title');
    const artistEl = document.querySelector('.track-artist');
    
    if (titleEl) titleEl.textContent = track.title || 'Sin título';
    if (artistEl) artistEl.textContent = track.artist || 'Artista desconocido';
    
    if (track.url) {
      this.audio.src = track.url;
      this.audio.load();
    }
  }

  previousTrack() {
    console.log('Previous track');
    // Implementar lógica de track anterior
  }

  nextTrack() {
    console.log('Next track');
    // Implementar lógica de track siguiente
  }

  onTrackEnd() {
    this.isPlaying = false;
    const playBtn = document.querySelector('.play-btn');
    if (playBtn) {
      playBtn.innerHTML = '▶';
    }
    this.nextTrack();
  }

  resetView() {
    this.showSection('home');
    this.handleNav('home');
  }
}

// ============================================
// Inicialización
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  window.nowarfyApp = new NowarfyApp();
});

// ============================================
// Funciones globales (compatibilidad)
// ============================================
function resetView() {
  if (window.nowarfyApp) {
    window.nowarfyApp.resetView();
  }
}

function showSection(section) {
  if (window.nowarfyApp) {
    window.nowarfyApp.showSection(section);
  }
}