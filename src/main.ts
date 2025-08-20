import * as THREE from 'three';
import './style.css';

const LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
const NUM_LANES = 4;
const LANE_WIDTH = 2;
const LANE_GAP = 0.5;

class Note {
    mesh: THREE.Mesh;
    lane: number;

    constructor(lane: number, color: THREE.ColorRepresentation) {
        this.lane = lane;
        const size = LANE_WIDTH / 2.5;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.4,
            metalness: 0.6,
        });
        this.mesh = new THREE.Mesh(geometry, material);
    }

    update(delta: number, speed: number) {
        this.mesh.position.y -= speed * delta;
        this.mesh.rotation.x += delta * 2;
        this.mesh.rotation.y += delta * 2;
    }
}

class Particle {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    lifespan: number;

    constructor(position: THREE.Vector3, color: THREE.ColorRepresentation) {
        const geometry = new THREE.SphereGeometry(0.1, 8, 8);
        const material = new THREE.MeshStandardMaterial({
            color: color,
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3
        );
        this.lifespan = Math.random() * 0.5 + 0.3;
    }

    update(delta: number) {
        this.lifespan -= delta;
        this.mesh.position.add(this.velocity.clone().multiplyScalar(delta));
    }
}

class Game {
    private scene: THREE.Scene;
    private camera: THREE.OrthographicCamera;
    private renderer: THREE.WebGLRenderer;
    private audioListener: THREE.AudioListener;
    private sound: THREE.Audio;
    private analyser: THREE.AudioAnalyser;
    private clock: THREE.Clock;

    private startScreen: HTMLElement;
    private uiContainer: HTMLElement;
    private scoreElement: HTMLElement;
    private lifeElement: HTMLElement;
    private missElement: HTMLElement;
    private keyDisplay: HTMLElement;

    private score = 0;
    private life = 100;
    private notes: Note[] = [];
    private particles: Particle[] = [];
    private lanePositions: number[];
    private hitZoneMeshes: THREE.Mesh[] = [];
    private originalHitZoneColors: THREE.Color[] = [];
    private lastBeatTime = 0;
    private beatThreshold = 40;
    private noteCooldown = 0.4;
    private noteSpeed = 8;

    private hitZoneY = -4;
    private hitThreshold = 0.5;
    
    private isGameOver = false;

    constructor() {
        const aspect = window.innerWidth / window.innerHeight;
        const viewHeight = 10;
        const viewWidth = viewHeight * aspect;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-viewWidth / 2, viewWidth / 2, viewHeight / 2, -viewHeight / 2, 0.1, 100);
        this.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas') as HTMLCanvasElement, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.audioListener = new THREE.AudioListener();
        this.camera.add(this.audioListener);
        this.sound = new THREE.Audio(this.audioListener);
        this.analyser = new THREE.AudioAnalyser(this.sound, 32);
        this.clock = new THREE.Clock();
        this.startScreen = document.getElementById('start-screen')!;
        this.uiContainer = document.getElementById('ui-container')!;
        this.scoreElement = document.getElementById('score')!;
        this.lifeElement = document.getElementById('life')!;
        this.missElement = document.getElementById('miss-notification')!;
        this.keyDisplay = document.getElementById('key-display')!;
        const totalWidth = NUM_LANES * LANE_WIDTH + (NUM_LANES - 1) * LANE_GAP;
        this.lanePositions = Array.from({ length: NUM_LANES }, (_, i) => -totalWidth / 2 + LANE_WIDTH / 2 + i * (LANE_WIDTH + LANE_GAP));
        this.init();
    }
    private init() {
        this.camera.position.z = 10;
        this.scene.background = new THREE.Color(0x111111);
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
        const pointLight = new THREE.PointLight(0xffffff, 2.5);
        pointLight.position.set(0, 5, 5);
        this.scene.add(pointLight);

        const laneColors = [new THREE.Color(0xff00ff), new THREE.Color(0x00ff00), new THREE.Color(0xffff00), new THREE.Color(0xff0000)];
        
        const laneLineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });
        const totalWidth = NUM_LANES * LANE_WIDTH + (NUM_LANES - 1) * LANE_GAP;
        for (let i = 0; i <= NUM_LANES; i++) {
            const x = -totalWidth / 2 + i * (LANE_WIDTH + LANE_GAP) - (LANE_WIDTH + LANE_GAP) / 2;
            const points = [new THREE.Vector3(x, 10, -1), new THREE.Vector3(x, -10, -1)];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, laneLineMaterial);
            this.scene.add(line);
        }

        this.lanePositions.forEach((x, i) => {
            const hitZoneGeo = new THREE.PlaneGeometry(LANE_WIDTH, 0.5);
            const color = laneColors[i];
            this.originalHitZoneColors[i] = color;
            const hitZoneMat = new THREE.MeshStandardMaterial({
                color: color,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            });
            const hitZoneMesh = new THREE.Mesh(hitZoneGeo, hitZoneMat);
            hitZoneMesh.position.set(x, this.hitZoneY, 0);
            this.scene.add(hitZoneMesh);
            this.hitZoneMeshes.push(hitZoneMesh);
        });
        window.addEventListener('resize', this.onWindowResize.bind(this));
        document.getElementById('start-button')!.addEventListener('click', () => {
            this.audioListener.context.resume().then(() => this.startGame());
        });
        document.addEventListener('keydown', this.onKeyPress.bind(this));
        this.displayHighScores();
    }

    private showStartScreen() {
        this.startScreen.style.display = 'flex';
        this.uiContainer.style.display = 'none';
        this.uiContainer.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <h1 id="song-title" class="h4">Now Playing: Starlight Fever</h1>
        </div>
        <div>
          <span class="h4 me-4">Life: <span id="life">100</span></span>
          <span class="h4">Score: <span id="score">0</span></span>
        </div>
      </div>`;
        this.displayHighScores();
    }

    private startGame() {
        this.notes.forEach(note => this.scene.remove(note.mesh));
        this.notes = [];
        this.particles.forEach(particle => this.scene.remove(particle.mesh));
        this.particles = [];

        this.startScreen.style.display = 'none';

        this.scoreElement = document.getElementById('score')!;
        this.lifeElement = document.getElementById('life')!;

        this.uiContainer.style.display = 'block';
        this.keyDisplay.style.display = 'flex';
        this.isGameOver = false;
        this.score = 0;
        this.life = 100;
        this.updateUI();
        
        const audioLoader = new THREE.AudioLoader();
        audioLoader.load('StarlightFever.mp3', (buffer) => {
            if (this.sound.isPlaying) this.sound.stop();
            this.sound.setBuffer(buffer);
            this.sound.setLoop(false);
            this.sound.setVolume(0.5);
            this.sound.play();
            this.clock.start();
            this.animate();
        }, undefined, (error) => {
            console.error('Audio could not be loaded:', error);
        });
    }
    private onKeyPress(event: KeyboardEvent) {
        if (this.isGameOver || event.repeat || !this.sound.isPlaying)
            return;
        const laneIndex = LANE_KEYS.indexOf(event.code);
        if (laneIndex === -1)
            return;
        const hitZoneMesh = this.hitZoneMeshes[laneIndex];
        const material = hitZoneMesh.material as THREE.MeshStandardMaterial;
        
        // Flash effect
        material.opacity = 0.9;
        setTimeout(() => {
            material.opacity = 0.5;
        }, 150);

        const hitMin = this.hitZoneY - this.hitThreshold;
        const hitMax = this.hitZoneY + this.hitThreshold;
        
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const note = this.notes[i];
            if (note.lane === laneIndex && note.mesh.position.y >= hitMin && note.mesh.position.y <= hitMax) {
                this.createParticles(note.mesh.position, this.originalHitZoneColors[laneIndex]);
                this.scene.remove(note.mesh);
                this.notes.splice(i, 1);
                this.score += 10;
                this.updateUI();
                break; 
            }
        }
    }

    private createParticles(position: THREE.Vector3, color: THREE.Color) {
        for (let i = 0; i < 15; i++) {
            const particle = new Particle(position, color);
            this.particles.push(particle);
            this.scene.add(particle.mesh);
        }
    }

    private updateUI() {
        this.scoreElement.textContent = this.score.toString();
        this.lifeElement.textContent = this.life.toString();
        if (this.life <= 0 && !this.isGameOver) {
            this.handleGameOver();
        }
    }

    private showMiss() {
        this.missElement.style.display = 'block';
        setTimeout(() => {
            this.missElement.style.display = 'none';
        }, 500);
    }

    private onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        const viewHeight = 10;
        const viewWidth = viewHeight * aspect;
        this.camera.left = -viewWidth / 2;
        this.camera.right = viewWidth / 2;
        this.camera.top = viewHeight / 2;
        this.camera.bottom = -viewHeight / 2;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private getHighScores(): number[] {
        const scoresJSON = localStorage.getItem('highScores');
        return scoresJSON ? JSON.parse(scoresJSON) : [];
    }

    private saveHighScores(scores: number[]) {
        localStorage.setItem('highScores', JSON.stringify(scores));
    }

    private displayHighScores() {
        const container = document.getElementById('high-scores-container');
        if (!container) return;

        const highScores = this.getHighScores();
        if (highScores.length === 0) {
            container.innerHTML = '';
            return;
        }

        let highScoresHTML = highScores.map((score, index) => `<li>${index + 1}. ${score}</li>`).join('');
        container.innerHTML = `
            <h2>High Scores</h2>
            <ul class="list-unstyled">${highScoresHTML}</ul>
        `;
    }

    private handleGameOver() {
        this.isGameOver = true;
        if (this.sound.isPlaying) {
            this.sound.stop();
        }

        const highScores = this.getHighScores();
        highScores.push(this.score);
        highScores.sort((a, b) => b - a);
        const newHighScores = highScores.slice(0, 5);
        this.saveHighScores(newHighScores);

        let highScoresHTML = newHighScores.map((score, index) => `<li>${index + 1}. ${score}</li>`).join('');

        this.uiContainer.innerHTML = `
            <div class="text-center">
                <h1 class="display-3">Game Over!</h1>
                <p class="lead">Final Score: ${this.score}</p>
                <hr>
                <h2>High Scores</h2>
                <ul class="list-unstyled">${highScoresHTML}</ul>
                <hr>
                <p class="lead">Press Enter to return to the Lobby</p>
            </div>`;

        this.uiContainer.style.display = 'block';
        this.keyDisplay.style.display = 'none';
        const onEnter = (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                document.removeEventListener('keydown', onEnter);
                this.showStartScreen();
            }
        };
        document.addEventListener('keydown', onEnter);
    }
    private animate() {
        if (!this.sound.isPlaying && this.notes.length === 0 && !this.isGameOver) {
            this.handleGameOver();
            return;
        }
        if (this.isGameOver)
            return;
            
        requestAnimationFrame(this.animate.bind(this));
        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();
        const freqData = this.analyser.getAverageFrequency();

        if (freqData > this.beatThreshold && (time - this.lastBeatTime) > this.noteCooldown) {
            this.lastBeatTime = time;
            const lane = Math.floor(Math.random() * NUM_LANES);
            const newNote = new Note(lane, this.originalHitZoneColors[lane]);
            newNote.mesh.position.set(this.lanePositions[lane], this.camera.top + 1, 0);
            this.notes.push(newNote);
            this.scene.add(newNote.mesh);
        }
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const note = this.notes[i];
            note.update(delta, this.noteSpeed);
            if (note.mesh.position.y < this.hitZoneY - this.hitThreshold) {
                this.scene.remove(note.mesh);
                this.notes.splice(i, 1);
                this.life -= 10; // More punishing
                this.showMiss();
                this.updateUI();
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.update(delta);
            if (particle.lifespan <= 0) {
                this.scene.remove(particle.mesh);
                this.particles.splice(i, 1);
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
}
new Game();
