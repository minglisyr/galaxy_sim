import galaxyVortexShader from '/src/shaders/vertex.glsl';
import galaxyFragmentShader from '/src/shaders/fragment.glsl';
import computeShaderVelocity from '/src/shaders/computeShaderVelocity.glsl';
import computeShaderPosition from '/src/shaders/computeShaderPosition.glsl';
import {GUI} from "dat.gui";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";

import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {GPUComputationRenderer} from "three/examples/jsm/misc/GPUComputationRenderer";
import {EffectComposer} from "three/examples/jsm/postprocessing/EffectComposer";
import {RenderPass} from "three/examples/jsm/postprocessing/RenderPass";
import {ShaderPass} from "three/examples/jsm/postprocessing/ShaderPass";
import {BlendShader} from "three/examples/jsm/shaders/BlendShader";
import {SavePass} from "three/examples/jsm/postprocessing/SavePass";
import {CopyShader} from "three/examples/jsm/shaders/CopyShader";

let container, stats;
let camera, scene, renderer, geometry, composer;


let gpuCompute;
let velocityVariable;
let positionVariable;
let velocityUniforms;
let particleUniforms;
let effectController;
let particles;
let material;
let controls;
let luminosity;
let paused = false;
// motion blur
let renderTargetParameters;
let savePass;
let blendPass;
/*--------------------------INITIALISATION-----------------------------------------------*/
const gravity = 20;
const interactionRate = 1.0;
const timeStep = 0.001;
const blackHoleForce = 100.0;
const constLuminosity = 1.0;
const numberOfStars = 1000;
const radius = 100;
const height = 5;
const middleVelocity = 2;
const velocity = 15;
renderTargetParameters = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false
};

// save pass
savePass = new SavePass(
    new THREE.WebGLRenderTarget(
        window.innerWidth,
        window.innerHeight,
        renderTargetParameters
    )
);

// blend pass
blendPass = new ShaderPass(BlendShader, "tDiffuse1");
blendPass.uniforms["tDiffuse2"].value = savePass.renderTarget.texture;
blendPass.uniforms["mixRatio"].value = 0.5;

// output pass
const outputPass = new ShaderPass(CopyShader);
outputPass.renderToScreen = true;

effectController = {
    // Can be changed dynamically
    gravity: gravity,
    interactionRate: interactionRate,
    timeStep: timeStep,
    blackHoleForce: blackHoleForce,
    luminosity: constLuminosity,
    maxAccelerationColor: 50.0,
    maxAccelerationColorPercent: 5,

    // Must restart simulation
    numberOfStars: numberOfStars,
    radius: radius,
    height: height,
    middleVelocity: middleVelocity,
    velocity: velocity,
};

let PARTICLES = effectController.numberOfStars;

/*-------------------------------------------------------------------------*/
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
    container.appendChild( stats.dom );

    window.addEventListener( 'resize', onWindowResize );

    initGUI();
    initParticles();
    dynamicValuesChanger();
    const renderScene = new RenderPass( scene, camera );



    composer = new EffectComposer( renderer );
    composer.addPass( renderScene );
    composer.addPass(blendPass);
    composer.addPass(savePass);
    composer.addPass(outputPass);
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
    velocityUniforms[ 'gravity' ] = { value: 0.0 };
    velocityUniforms[ 'interactionRate' ] = { value: 0.0 };
    velocityUniforms[ 'timeStep' ] = { value: 0.0 };
    velocityUniforms[ 'uMaxAccelerationColor' ] = { value: 0.0 };
    velocityUniforms[ 'blackHoleForce' ] = { value: 0.0 };
    velocityUniforms[ 'luminosity' ] = { value: 0.0 };

    const error = gpuCompute.init();

    if ( error !== null ) {
        console.error( error );
    }
}

function initParticles() {

    // Create a buffer geometry to store the particle data
    geometry = new THREE.BufferGeometry();

    // Create array to store the position of the particles
    const positions = new Float32Array( PARTICLES * 3 );

    // Create an array to store the UV coordinates of each particle
    const uvs = new Float32Array( PARTICLES * 2 );

    // Calculate the size of the matrix based on the number of particles
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
        'uMaxAccelerationColor': { value: effectController.maxAccelerationColor },
        'uLuminosity' : { value: luminosity},
    };

    // THREE.ShaderMaterial
    // Create the material of the particles
    material = new THREE.ShaderMaterial( {
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: particleUniforms,
        vertexShader:  galaxyVortexShader,
        fragmentShader:  galaxyFragmentShader
    });

    particles = new THREE.Points( geometry, material );
    particles.frustumCulled = false;
    particles.matrixAutoUpdate = false;
    particles.updateMatrix();
    scene.add( particles );
}

/**
 * Init positions et volocities for all particles
 * @param texturePosition array that contain positions of particles
 * @param textureVelocity array that contain velocities of particles
 */
function fillTextures( texturePosition, textureVelocity ) {

    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    const radius = effectController.radius;
    const height = effectController.height;
    const middleVelocity = effectController.middleVelocity;
    const maxVel = effectController.velocity;

    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        // Position
        let x, z, rr, y, vx, vy, vz;
        // The first particle will be the black hole
        if (k === 0){
            x = 0;
            z = 0;
            y = 0;
            rr = 0;
        } else {
            // Generate random position for the particle within the radius
            do {
                x = ( Math.random() * 2 - 1 );
                z = ( Math.random() * 2 - 1 );
                // The variable rr is used to calculate the distance from the center of the radius for each particle.
                // It is used in the calculation of rExp which is used to determine the position of the particle within the radius.
                // If a particle is closer to the center, rr will be smaller, and rExp will be larger, which means that the particle will be placed closer to the center.
                // It also can affect the velocity of the particle as it is used in the calculation of the velocity of the particle.
                rr = x * x + z * z;

            } while ( rr > 1 );
            rr = Math.sqrt( rr );

            const rExp = radius * Math.pow( rr, middleVelocity );

            // Velocity
            const vel = maxVel * Math.pow( rr, 0.2 );

            vx = vel * z + ( Math.random() * 2 - 1 ) * 0.001;
            vy = ( Math.random() * 2 - 1 ) * 0.001 * 0.05;
            vz = - vel * x + ( Math.random() * 2 - 1 ) * 0.001;

            x *= rExp;
            z *= rExp;
            y = ( Math.random() * 2 - 1 ) * height;
        }

        // Fill in texture values
        posArray[ k + 0 ] = x;
        posArray[ k + 1 ] = y;
        posArray[ k + 2 ] = z;

        velArray[ k + 0 ] = vx;
        velArray[ k + 1 ] = vy;
        velArray[ k + 2 ] = vz;
        velArray[ k + 3 ] = 0;
    }
}

/**
 * Restart the simulation
 */
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

/**
 * manage the resize of the windows to keep the scene centered
 */
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    particleUniforms[ 'cameraConstant' ].value = getCameraConstant( camera );
}

function dynamicValuesChanger() {
    velocityUniforms[ 'gravity' ].value = effectController.gravity;
    velocityUniforms[ 'interactionRate' ].value = effectController.interactionRate;
    velocityUniforms[ 'timeStep' ].value = effectController.timeStep;
    console.log(effectController.maxAccelerationColor);
    velocityUniforms[ 'uMaxAccelerationColor' ].value = effectController.maxAccelerationColor;
    velocityUniforms[ 'blackHoleForce' ].value = effectController.blackHoleForce;
    velocityUniforms[ 'luminosity' ].value = effectController.luminosity;
}

/**
 * Init the menu
 */
function initGUI() {

    const gui = new GUI( { width: 350 } );

    const folder1 = gui.addFolder( 'Dynamic Parameters' );

    const folderGraphicSettings = gui.addFolder( 'Graphics settings' );

    const folder2 = gui.addFolder( 'Static parameters (need to restart the simulation)' );

    folder1.add( effectController, 'gravity', 0.0, 1000.0, 0.05 ).onChange( dynamicValuesChanger ).name("Gravitational force");
    folder1.add( effectController, 'interactionRate', 0.0, 1.0, 0.001 ).onChange( dynamicValuesChanger ).name("Interaction rate (%)");
    folder1.add( effectController, 'timeStep', 0.0, 0.01, 0.0001 ).onChange( dynamicValuesChanger ).name("Time step");

    folderGraphicSettings.add( effectController, 'maxAccelerationColorPercent', 0.01, 100, 0.01 ).onChange(  function ( value ) {
        effectController.maxAccelerationColor = value * 10;
        dynamicValuesChanger();
    }  ).name("Colors mix (%)");

    folder2.add( effectController, 'numberOfStars', 2.0, 1000000.0, 1.0 ).name("Number of stars");
    folder2.add( effectController, 'radius', 1.0, 1000.0, 1.0 ).name("Galaxy diameter");
    folder2.add( effectController, 'height', 0.0, 50.0, 0.01 ).name("Galaxy height");
    folder2.add( effectController, 'middleVelocity', 0.0, 20.0, 0.001 ).name("Center rotation speed");
    folder2.add( effectController, 'velocity', 0.0, 150.0, 0.1 ).name("Initial rotation speed");

    const buttonRestart = {
        restartSimulation: function () {
            restartSimulation();
        }
    };

    const buttonPause = {
        pauseSimulation: function () {
        }
    };

    folder2.add( buttonRestart, 'restartSimulation' ).name("Restart the simulation");

    let buttonPauseController = folder2.add( buttonPause, 'pauseSimulation' ).name("Pause");
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
    folder2.open();
    folderGraphicSettings.open();

}

function getCameraConstant( camera ) {
    return window.innerHeight / ( Math.tan( THREE.MathUtils.DEG2RAD * 0.5 * camera.fov ) / camera.zoom );
}

/***Switch the current simulation***/
function switchSimulation(){
    paused = false;
    // Normal mode (small configuration)
    scene.remove(particles);

    effectController = {
    };
    material.dispose();
    geometry.dispose();
    document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

    document.body.removeChild(document.querySelector('canvas').parentNode);

    PARTICLES = effectController.numberOfStars;

    init();
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
        material.uniforms.uMaxAccelerationColor.value = effectController.maxAccelerationColor;
    }

    composer.removePass(blendPass);
    composer.removePass(savePass);
    composer.removePass(outputPass);

    material.uniforms.uLuminosity.value = effectController.luminosity;
    composer.render(scene, camera);

}

init();
animate();
