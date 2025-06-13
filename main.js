import vortexShader from '/src/shaders/vertex.glsl';
import fragmentShader from '/src/shaders/fragment.glsl';
import computeShaderVelocity from '/src/shaders/computeShaderVelocity.glsl';
import computeShaderPosition from '/src/shaders/computeShaderPosition.glsl';
import {GUI} from "dat.gui";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {GPUComputationRenderer} from "three/examples/jsm/misc/GPUComputationRenderer";

let container, stats;
let camera, scene, renderer, geometry;

let gpuCompute;
let velocityVariable;
let positionVariable;
let velocityUniforms;
let particleUniforms;
let effectController;
let particles;
let material;
let controls;
let paused = false;

// Simulation parameters
const gravity = 10.0;
const interactionRate = 1.0;
const timeStep = 0.001;
const blackHoleForce = 100.0;
const constLuminosity = 1.0;
const numberOfStars = 20000;
const radius = 500;
const height = 5;
const centerVelocity = 1;
const velocity = 5;
const maxAccelerationColor = 10.0;

effectController = {
    // Must restart simulation
    gravity: gravity,
    blackHoleForce: blackHoleForce,
    numberOfStars: numberOfStars,
    radius: radius,
    height: height,
    centerVelocity: centerVelocity,
    velocity: velocity,
};

let PARTICLES = effectController.numberOfStars;

function init() {
    container = document.createElement( 'div' );
    document.body.appendChild( container );

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 9999999999999999999 );
    camera.position.x = 15
    camera.position.y = 112;
    camera.position.z = 168;

    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    container.appendChild( renderer.domElement );

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = false;

    initComputeRenderer();

    // Show fps, ping, etc
    stats = new Stats();
    container.appendChild(stats.dom);

    window.addEventListener('resize', onWindowResize);

    initGUI();
    initParticles();
}

function initComputeRenderer() {
    let textureSize = Math.round(Math.sqrt(effectController.numberOfStars));
    gpuCompute = new GPUComputationRenderer( textureSize, textureSize, renderer );
    if ( renderer.capabilities.isWebGL2 === false ) {
        gpuCompute.setDataType( THREE.HalfFloatType );
    }

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();

    fillTextures( dtPosition, dtVelocity );

    velocityVariable = gpuCompute.addVariable( 'textureVelocity', computeShaderVelocity, dtVelocity );
    positionVariable = gpuCompute.addVariable( 'texturePosition', computeShaderPosition, dtPosition );

    gpuCompute.setVariableDependencies( velocityVariable, [ positionVariable, velocityVariable ] );
    gpuCompute.setVariableDependencies( positionVariable, [ positionVariable, velocityVariable ] );

    velocityUniforms = velocityVariable.material.uniforms;
    velocityUniforms[ 'gravity' ] = { value:  gravity };
    velocityUniforms[ 'interactionRate' ] = { value: interactionRate };
    velocityUniforms[ 'timeStep' ] = { value: timeStep };
    velocityUniforms[ 'uMaxAccelerationColor' ] = { value: maxAccelerationColor };
    velocityUniforms[ 'blackHoleForce' ] = { value: blackHoleForce };
    velocityUniforms[ 'luminosity' ] = { value: constLuminosity };

    const error = gpuCompute.init();

    if ( error !== null ) {
        console.error( error );
    }
}

function initParticles() {
    geometry = new THREE.BufferGeometry();
    const positions = new Float32Array( PARTICLES * 3 );
    const uvs = new Float32Array( PARTICLES * 2 );

    let matrixSize = Math.sqrt(effectController.numberOfStars);
    let p = 0;
    for ( let j = 0; j < matrixSize; j ++ ) {
        for ( let i = 0; i < matrixSize; i ++ ) {
            uvs[ p ++ ] = i / ( matrixSize - 1 );
            uvs[ p ++ ] = j / ( matrixSize - 1 );
        }
    }

    geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
    geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );

    particleUniforms = {
        'texturePosition': { value: null },
        'textureVelocity': { value: null },
        'cameraConstant': { value: getCameraConstant( camera ) },
        'particlesCount': { value: PARTICLES },
        'uMaxAccelerationColor': { value: maxAccelerationColor },
        'uLuminosity' : { value: constLuminosity},
    };

    material = new THREE.ShaderMaterial( {
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: particleUniforms,
        vertexShader:  vortexShader,
        fragmentShader:  fragmentShader
    });

    particles = new THREE.Points( geometry, material );
    particles.frustumCulled = false;
    particles.matrixAutoUpdate = false;
    particles.updateMatrix();
    scene.add( particles );
}

function fillTextures( texturePosition, textureVelocity ) {
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    const radius = effectController.radius;
    const height = effectController.height;
    const centerVelocity = effectController.centerVelocity;
    const maxVel = effectController.velocity;

    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        let x, z, rr, y, vx, vy, vz;
        if (k === 0){
            x = 0;
            z = 0;
            y = 0;
            rr = 0;
        } else {
            do {
                x = ( Math.random() * 2 - 1 );
                z = ( Math.random() * 2 - 1 );
                rr = x * x + z * z;
            } while ( rr > 1 );
            rr = Math.sqrt( rr );

            const rExp = radius * Math.pow( rr, centerVelocity );
            const vel = maxVel * Math.pow( rr, 0.2 );

            vx = vel * z + ( Math.random() * 2 - 1 ) * 0.001;
            vy = ( Math.random() * 2 - 1 ) * 0.001 * 0.05;
            vz = - vel * x + ( Math.random() * 2 - 1 ) * 0.001;

            x *= rExp;
            z *= rExp;
            y = ( Math.random() * 2 - 1 ) * height;
        }

        posArray[ k + 0 ] = x;
        posArray[ k + 1 ] = y;
        posArray[ k + 2 ] = z;

        velArray[ k + 0 ] = vx;
        velArray[ k + 1 ] = vy;
        velArray[ k + 2 ] = vz;
        velArray[ k + 3 ] = 0;
    }
}

function restartSimulation() {
    paused = false;
    scene.remove(particles);
    material.dispose();
    geometry.dispose();
    document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));
    document.body.removeChild(document.querySelector('canvas').parentNode);
    PARTICLES = effectController.numberOfStars;
    init();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    particleUniforms[ 'cameraConstant' ].value = getCameraConstant( camera );
}

function initGUI() {
    const gui = new GUI( { width: 350 } );
    const folder1 = gui.addFolder( 'Static parameters (need to restart the simulation)' );
    folder1.add( effectController, 'gravity', 0.0, 100.0, 0.01 ).name("Gravity");
    folder1.add( effectController, 'blackHoleForce', 0.0, 10000.0, 1.0 ).name("Black hole force");
    folder1.add( effectController, 'numberOfStars', 2.0, 1000000.0, 1.0 ).name("Number of stars");
    folder1.add( effectController, 'radius', 1.0, 1000.0, 1.0 ).name("Galaxy diameter");
    folder1.add( effectController, 'height', 0.0, 50.0, 0.01 ).name("Galaxy height");
    folder1.add( effectController, 'centerVelocity', 0.0, 20.0, 0.001 ).name("Center rotation speed");
    folder1.add( effectController, 'velocity', 0.0, 150.0, 0.1 ).name("Initial rotation speed");

    const buttonRestart = {
        restartSimulation: function () {
            restartSimulation();
        }
    };

    const buttonPause = {
        pauseSimulation: function () {
        }
    };

    folder1.add( buttonRestart, 'restartSimulation' ).name("Restart the simulation");

    let buttonPauseController = folder1.add( buttonPause, 'pauseSimulation' ).name("Pause");
    buttonPauseController.onChange(function(){
        paused = !paused;
        if(paused){
            buttonPauseController.name("Resume");
        }else{
            buttonPauseController.name("Pause");
        }
        buttonPauseController.updateDisplay();
    });

    folder1.open();
}

function getCameraConstant( camera ) {
    return window.innerHeight / ( Math.tan( THREE.MathUtils.DEG2RAD * 0.5 * camera.fov ) / camera.zoom );
}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    render();
    stats.update();
}

function render() {
    if (!paused){
        gpuCompute.compute();
        particleUniforms[ 'texturePosition' ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
        particleUniforms[ 'textureVelocity' ].value = gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;
        material.uniforms.uMaxAccelerationColor.value = maxAccelerationColor;
    }
    material.uniforms.uLuminosity.value = constLuminosity;
    renderer.render(scene, camera);
}

init();
animate();
