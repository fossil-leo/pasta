import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
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
        const geometry = new THREE.BoxGeometry(LANE_WIDTH * 0.9, 0.5, 0.2);
        const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 1.5,
            roughness: 0.5,
            metalness: 0.5,
        });
        this.mesh = new THREE.Mesh(geometry, material);
    }

    update(delta: number, speed: number) {
        this.mesh.position.y -= speed * delta;
        this.mesh.rotation.x += delta * 0.5;
        this.mesh.rotation.y += delta * 0.5;
    }
}

class Game {
    private scene: THREE.Scene;
    private camera: THREE.OrthographicCamera;
    private renderer: THREE.WebGLRenderer;
    private composer: EffectComposer;
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
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.composer = new EffectComposer(this.renderer);
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
        this.scene.background = new THREE.Color(0x000000);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.2));
        const pointLight = new THREE.PointLight(0xffffff, 0.8);
        pointLight.position.set(0, 5, 5);
        this.scene.add(pointLight);
        const renderPass = new RenderPass(this.scene, this.camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0;
        bloomPass.strength = 1.2;
        bloomPass.radius = 0.5;
        this.composer.addPass(renderPass);
        this.composer.addPass(bloomPass);
        const laneColors = [new THREE.Color(0xff00ff), new THREE.Color(0x00ff00), new THREE.Color(0xffff00), new THREE.Color(0xff0000)];
        this.lanePositions.forEach((x, i) => {
            const hitZoneGeo = new THREE.PlaneGeometry(LANE_WIDTH, 0.5);
            const color = laneColors[i];
            this.originalHitZoneColors[i] = color;
            const hitZoneMat = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.4
            });
            const hitZoneMesh = new THREE.Mesh(hitZoneGeo, hitZoneMat);
            hitZoneMesh.position.set(x, this.hitZoneY, 0);
            this.scene.add(hitZoneMesh);
            this.hitZoneMeshes.push(hitZoneMesh);
        });
        window.addEventListener('resize', this.onWindowResize.bind(this));
        document.getElementById('start-button')!.addEventListener('click', this.startGame.bind(this));
        document.addEventListener('keydown', this.onKeyPress.bind(this));
    }

    private showStartScreen() {
        this.startScreen.classList.replace('d-none', 'd-flex');
        this.uiContainer.style.display = 'none';
    }

    private async startGame() {
        this.startScreen.classList.replace('d-flex', 'd-none');

        // Restore the UI container's original content
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
        
        // Re-acquire the element references
        this.scoreElement = document.getElementById('score')!;
        this.lifeElement = document.getElementById('life')!;

        this.uiContainer.style.display = 'block';
        this.keyDisplay.style.display = 'flex';
        this.isGameOver = false;
        this.score = 0;
        this.life = 100;
        this.updateUI();
        
        try {
            await this.audioListener.context.resume();
        }
        catch (e) {
            console.error(e);
            return;
        }
        const audioLoader = new THREE.AudioLoader();
        try {
            const buffer = await audioLoader.loadAsync('/Starlight Fever.mp3');
            this.sound.setBuffer(buffer);
            this.sound.setLoop(false);
            this.sound.setVolume(0.5);
            this.sound.play();
        }
        catch (error) {
            console.error(error);
            return;
        }
        this.animate();
    }
    private onKeyPress(event: KeyboardEvent) {
        if (this.isGameOver || event.repeat || !this.sound.isPlaying)
            return;
        const laneIndex = LANE_KEYS.indexOf(event.code);
        if (laneIndex === -1)
            return;
        const hitZoneMesh = this.hitZoneMeshes[laneIndex];
        const material = hitZoneMesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 2.5;
        material.opacity = 1.0;
        setTimeout(() => {
            material.emissiveIntensity = 0.5;
            material.opacity = 0.4;
        }, 120);
        const hitMin = this.hitZoneY - this.hitThreshold;
        const hitMax = this.hitZoneY + this.hitThreshold;
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const note = this.notes[i];
            if (note.lane === laneIndex && note.mesh.position.y >= hitMin && note.mesh.position.y <= hitMax) {
                this.scene.remove(note.mesh);
                this.notes.splice(i, 1);
                this.score += 10;
                this.updateUI();
                break;
            }
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
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    private handleGameOver() {
        this.isGameOver = true;
        if (this.sound.isPlaying) {
            this.sound.stop();
        }
        this.uiContainer.innerHTML = `<h1 class="display-3 text-center">Game Over! Final Score: ${this.score}</h1><p class="text-center lead">Press Enter to return to the Lobby</p>`;
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
                this.life -= 1;
                this.showMiss();
                this.updateUI();
            }
        }
        this.composer.render();
    }
}
new Game();
