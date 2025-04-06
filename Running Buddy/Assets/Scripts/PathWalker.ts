import { ProgressBarController } from "./ProgressBarController";
import { SoundController } from "./SoundController";
import { Timer } from "./Timer"
import { UI } from "./UI";
import { ArrowsSpawner } from "./ArrowsSpawner";
import { LensInitializer } from "./LensInitializer";
import { CatmullRomSpline } from "./Helpers/CatmullRomSpline";
import { PathBuilder } from "./PathBuilder";
import { Conversions } from "./Conversions";
import { PlayerPaceCalculator } from "./PlayerPaceCalculator";
import { LineController } from "./LineController";
import { LinearAlgebra } from "./Helpers/LinearAlgebra";
import { WarningController } from "./WarningController";
import { Slider } from "../SpectaclesInteractionKit/Components/UI/Slider/Slider";

enum PathWalkerState {
    None,
    GoToStart,
    Walking
}

@component
export class PathWalker extends BaseScriptComponent {

    @input
    cam: SceneObject

    @input
    walkPathScreenHUD: SceneObject

    @input
    averagePaceText: Text

    @input
    lapCountText: Text

    @input
    timerScript: Timer

    @input
    uiScript: UI

    @input
    progressBarController: ProgressBarController

    @input
    arrowSpawner: ArrowsSpawner

    @input
    playerPaceCalulator: PlayerPaceCalculator

    @input
    warningController: WarningController

    @input
    protected pathRmv: RenderMeshVisual;

    @input
    @hint("The SceneObject that will be animated along the path")
    animatedObject: SceneObject

    @input
    @hint("The SceneObject containing the speed control slider")
    speedControlPanel: SceneObject

    @input
    @hint("The speed slider for controlling animation speed")
    speedSlider: SceneObject

    // State data
    private state: number = 0;
    private isOutsideSprint: boolean = false;
    public lapCount: number = -1;
    private totalTimeWalking: number = 0;
    private totalDistWalked: number = 0;
    private onWalkingFinished: (() => void) | undefined = undefined;

    // Path data
    private splinePoints: { position: vec3; rotation: quat }[] = []; // batched update based on resolution
    private pathPoints: vec3[] = null;
    // NEW: original path order for animation (start to finish)
    private animatedPath: vec3[] = [];
    private isLoop: boolean = false;
    private pathIsForwards: boolean = true; // Starting orientation
    private startLineController: LineController = null;
    private finishLineController: LineController = null;
    private pathLength: number = 0;

    // Ui Related data
    private isUiShown: boolean = false;
    private currentState = PathWalkerState.None;
    private isWarningShown: boolean = false;

    private leaderboardModule = require('LensStudio:LeaderboardModule');

    // Animation related variables
    private animationPosition: number = 0;
    private animationSpeed: number = 1;
    private sliderComponent: Slider;
    private isAnimating: boolean = false;

    public init() {
        if (this.uiScript && this.uiScript.endSessionClicked) {
            this.uiScript.endSessionClicked.add(() => {
                this.stop();
            });
        } else {
            print("[PathWalker] Warning: uiScript or endSessionClicked is undefined");
        }
        
        // NEW: Listen for new game button click from UI
        if (this.uiScript && this.uiScript.newGameClicked) {
            this.uiScript.newGameClicked.add(() => {
                this.resetState();
                if(this.onWalkingFinished){
                    this.onWalkingFinished();
                }
            });
        } else {
            print("[PathWalker] Warning: uiScript or newGameClicked is undefined");
        }
        
        this.resetState();
    }

    private onUpdate() {
        if (getDeltaTime() < 1/6000) {
            // we're in a capture loop
            return;
        }

        switch (this.state) {
            case 0: // inactive
                break;
            case 1: // prep
                break;
            case 2: // walking
                let stats = this.playerPaceCalulator.getPace(LensInitializer.getInstance().getPlayerGroundPos());

                // Implement warning at 15mph.
                let paceMph = Conversions.cmPerSecToMPH(stats.pace);
                let threshold = 15;
                if(this.isWarningShown && paceMph < threshold){
                    this.isWarningShown = false;
                    this.warningController.toggleWaring(this.isWarningShown);
                }else if(!this.isWarningShown && paceMph > threshold){
                    this.isWarningShown = true;
                    this.warningController.toggleWaring(this.isWarningShown);
                }

                if (stats.pace > 13) {
                    this.ensureUiHidden();
                } else {
                    this.ensureUiShown();
                }

                if (!this.isOutsideSprint) {
                    let t = this.getSplinePos().t;
                    this.updateProgressBar(t);

                    this.setPlayerStats(stats);
                }
                break;
            case 3: // finished
                break;
            default:
                break;
        }
    }

    private getSplinePos() {
        return CatmullRomSpline.worldToSplineSpace(LensInitializer.getInstance().getPlayerGroundPos(), this.splinePoints);
    }

    private updateProgressBar(t: number) {
        let addjustedT = this.pathIsForwards ? t : 1 - t;
        this.progressBarController.setProgress(addjustedT);
    }

    private setPlayerStats(stats: { nPos: vec3, pace: number, dist: number, dt: number }) {
        // calculate and update total average pace text
        this.totalDistWalked += stats.dist;
        this.totalTimeWalking += stats.dt;
        if (this.totalTimeWalking > 0) {
            let averagePaceMPH = Conversions.cmPerSecToMPH(this.totalDistWalked / this.totalTimeWalking);
            this.averagePaceText.text = averagePaceMPH.toFixed(1);
        }
    }

    public onStartCollisionExit(dot: number) {
        // If state is not 1 (prep) or 2 (walking), don't process collision events
        if (this.state !== 1 && this.state !== 2) return;

        if (dot > 0) {
            // We are in the direction of the start line
            if (this.state === 1) { // prep
                // We passed start for the first time
                this.playerPaceCalulator.start(LensInitializer.getInstance().getPlayerGroundPos());
                this.walkPathScreenHUD.enabled = true;
                this.updateProgressBar(0);
                this.lapCount = 0;
                this.currentState = PathWalkerState.Walking;
                this.updateUi();
                this.timerScript.start();
                this.state = 2;

                // NEW: hide the speed control panel when the game begins
                if (this.speedControlPanel) {
                    this.speedControlPanel.enabled = false;
                }

                SoundController.getInstance().playSound("startWalkPath");

                // SoundController.getInstance().playSound("onStartLap");

                this.arrowSpawner.start(this.pathPoints.concat([]).reverse(), this.splinePoints, this.pathLength);

                // We show the lap we will complete once we walk through
                if (this.isLoop) {
                    this.startLineController.onIncrementLoop(this.lapCount + 1);
                } else {
                    this.startLineController.onStartSprint();
                    this.finishLineController.onStartSprint();
                }
            } else if (this.state === 2) { // walking
                if (this.isLoop) {
                    // We are making a lap in the loop
                    this.incrementLap();
                } else {
                    // We are re-entering sprint
                    SoundController.getInstance().playSound("onStartLap");
                    this.isOutsideSprint = false;
                }
                this.timerScript.start();
            }
        } else {
            // We are going in reverse direction of the start line
            if (this.state === 2) { // walking
                if (this.isLoop) {
                    // There is no use case for this
                } else {
                    // We are finishing reverse sprint
                    this.timerScript.pause();
                    this.isOutsideSprint = true;
                    this.incrementLap();
                    this.reverseSprintTrackVisuals("start");
                }
            }
        }
    }

    public onFinishCollisionExit(dot: number) {
        // If state is not 2 (walking), don't process collision events
        if (this.state !== 2) return;
        
        if (dot > 0) {
            // We are finishing sprint
            this.timerScript.pause();
            this.isOutsideSprint = true;
            this.incrementLap();
            this.reverseSprintTrackVisuals("finish");
        } else {
            // We are re-entering reverse sprint
            SoundController.getInstance().playSound("onStartLap");
            this.isOutsideSprint = false;
            this.timerScript.start();
        }
    }

    private incrementLap() {
        SoundController.getInstance().playSound("onCompleteLap");
        this.timerScript.incrementLap();
        this.lapCount++;
        this.lapCountText.text = this.lapCount.toString();
        
        const timeInMs = this.timerScript.getCurrentTimeMs();
        const timeInSec = timeInMs / 1000; // convert ms to s
        print("[PathWalker] Lap completed in " + timeInSec + "s");
        this.submitLapTimeToLeaderboard(timeInMs);
        
        // Record lap time in seconds in the UI (if available)
        if (this.uiScript && this.uiScript.recordTime) {
            this.uiScript.recordTime.text = timeInSec.toFixed(2) + "s";
        }
        
        // Automatically end the session after one lap
        if (this.lapCount === 1) {
            print("[PathWalker] One lap completed, ending session");
            this.state = 3;
            this.stop();
            // Removed duplicate onWalkingFinished callback.
            return;
        }
        
        if (this.isLoop) {
            this.startLineController.onIncrementLoop(this.lapCount + 1);
        }
    }

    private submitLapTimeToLeaderboard(timeInMs: number): void {
        const leaderboardCreateOptions = Leaderboard.CreateOptions.create();
        leaderboardCreateOptions.name = 'RUNNING_BUDDIES_LAP_TIME';
        leaderboardCreateOptions.ttlSeconds = 800000;
        // Use orderingType 0 for lap times (lower is better)
        leaderboardCreateOptions.orderingType = 0;

        this.leaderboardModule.getLeaderboard(
            leaderboardCreateOptions,
            (leaderboardInstance) => {
                leaderboardInstance.submitScore(
                    timeInMs,
                    (currentUserInfo) => {
                        print('[Leaderboard] Lap time submitted successfully');
                        if (!isNull(currentUserInfo)) {
                            print(`[Leaderboard] User: ${
                                currentUserInfo.snapchatUser.displayName || ''
                            }, Lap Time: ${currentUserInfo.score}ms`);
                        }
                    },
                    (status) => {
                        print('[Leaderboard] Submit lap time failed, status: ' + status);
                    }
                );
            },
            (status) => {
                print('[Leaderboard] getLeaderboard failed, status: ' + status);
            }
        );
    }

    onSprintStartAreaCollision(reverseTrack:boolean){
        if(!this.isLoop){
            this.startLineController.onSprintStartAreaCollision();
            this.finishLineController.onSprintStartAreaCollision();
    
            if(reverseTrack){
                this.reverseSprintTrack();
            }
        }
    }

    private reverseSprintTrack(){
        // Fully switch positions of start and end 
        let startPos = this.startLineController.getTransform().getWorldPosition();
        let startRot = this.startLineController.getTransform().getWorldRotation();
        let flippedStartRot = LinearAlgebra.flippedRot(startRot, this.startLineController.getTransform().up);

        let finishPos = this.finishLineController.getTransform().getWorldPosition();
        let finishRot = this.finishLineController.getTransform().getWorldRotation();
        let flippedFinishRot = LinearAlgebra.flippedRot(finishRot, this.finishLineController.getTransform().up);

        this.startLineController.getTransform().setWorldPosition(finishPos);
        this.startLineController.getTransform().setWorldRotation(flippedFinishRot);
        this.finishLineController.getTransform().setWorldPosition(startPos);
        this.finishLineController.getTransform().setWorldRotation(flippedStartRot);

        // Revese spline
        this.splinePoints = this.splinePoints.reverse();

        // Only reverse relevant visuals
        this.pathPoints = this.pathPoints.reverse();
        this.pathRmv.mesh = PathBuilder.buildFromPoints(this.pathPoints, 60);
        this.arrowSpawner.start(this.pathPoints.concat([]).reverse(), this.splinePoints, this.pathLength);
    }

    private reverseSprintTrackVisuals(str: string) {
        let reverseTrack = false;

        if (str.includes("start") && !this.pathIsForwards) {
            this.pathIsForwards = true;
            reverseTrack = true;
        }
        if (str.includes("finish") && this.pathIsForwards) {
            this.pathIsForwards = false;
            reverseTrack = true;
        }
        if (reverseTrack && this.pathPoints && this.pathPoints.length > 0) {
            // Make sure pathPoints is valid before using it
            this.pathPoints = this.pathPoints.reverse();
            this.pathRmv.mesh = PathBuilder.buildFromPoints(this.pathPoints, 60);
            if (this.startLineController && this.finishLineController) {
                this.arrowSpawner.start(this.pathPoints.concat([]).reverse(), this.splinePoints, this.pathLength);
                this.startLineController.onReverseSprintTrackVisuals();
                this.finishLineController.onReverseSprintTrackVisuals();
            }
        }
    }

    private resetState() {
        // State data
        this.state = 0;
        this.isOutsideSprint = false;
        this.lapCount = -1;
        this.totalTimeWalking = 0;
        this.totalDistWalked = 0;

        // Path data
        this.pathIsForwards = true;
        this.splinePoints = [];
        this.pathPoints = [];
        this.isLoop = false;

        // Path visual
        this.pathRmv.enabled = false;
        this.arrowSpawner.stop();
        if (this.startLineController) {
            this.startLineController.getSceneObject().destroy();
            this.startLineController = null;
        }
        if (this.finishLineController) {
            this.finishLineController.getSceneObject().destroy();
            this.finishLineController = null;
        }

        // Stop animation if it's running
        this.stopAnimation();
        
        // Reset animation variables
        this.animationPosition = 0;
        this.animationSpeed = 1;
        this.isAnimating = false;

        // HUD
        if(this.timerScript.getSceneObject().isEnabledInHierarchy){
            this.timerScript.stop();
        }
        this.averagePaceText.text = "0";
        this.lapCountText.text = "0";

        this.walkPathScreenHUD.enabled = false;

        // UI data
        this.ensureUiHidden();
    }

    public start(
        mySplinePoints: { position: vec3, rotation: quat }[],
        myIsLoop: boolean,
        myStartLineTr: Transform,
        myFinishLineTr: Transform | undefined = undefined,
        onWalkingFinished: (() => void) | undefined = undefined,
    ) {
        // state
        this.resetState();
        this.state = 1;

        // NEW: assign spline points for proper spline calculations
        this.splinePoints = mySplinePoints;
        
        // Set path data from PathMaker
        // NEW: capture original path order
        let originalPath = mySplinePoints.map(s => s.position);
        this.animatedPath = originalPath.concat(); // keep original order for animated object

        // Use reversed order for visual paths
        this.pathPoints = originalPath.slice().reverse();
        this.pathLength = 0;
        for (let i = 1; i < originalPath.length; i++) {
            this.pathLength += originalPath[i].distance(originalPath[i - 1]);
        }
        this.isLoop = myIsLoop;
        this.pathRmv.mesh = PathBuilder.buildFromPoints(this.pathPoints, 60);
        this.pathRmv.enabled = true;

        this.startLineController = myStartLineTr.getSceneObject().getComponent(LineController.getTypeName());
        this.startLineController.setEnableWalkCountdown();

        if (!isNull(myFinishLineTr)) {
            this.finishLineController = myFinishLineTr.getSceneObject().getComponent(LineController.getTypeName());
            this.finishLineController.setEnableWalkCountdown();
        }

        this.createEvent("UpdateEvent").bind(() => this.onUpdate());
        this.currentState = PathWalkerState.GoToStart;
        this.ensureUiShown();
        this.onWalkingFinished = onWalkingFinished;

        // Pass original path order to arrowSpawner so arrows point from start to finish
        this.arrowSpawner.start(originalPath, this.splinePoints, this.pathLength);
        
        // Start the animation once the path is created
        this.startAnimation();
    }

    public stop() { 
        SoundController.getInstance().stopAllSounds();
        
        // Submit final distance as a separate leaderboard entry
        const finalScore = Math.floor(this.totalDistWalked);
        if (finalScore > 0) {
            this.submitDistanceToLeaderboard(finalScore);
        }
        
        // Instead of resetting immediately, show leaderboard with new game button.
        this.uiScript.showLeaderboardWithNewGame();
        
        // Removed: this.resetState();
    }

    private submitDistanceToLeaderboard(distance: number): void {
        const leaderboardCreateOptions = Leaderboard.CreateOptions.create();
        leaderboardCreateOptions.name = 'RUNNING_BUDDIES_DISTANCE';
        leaderboardCreateOptions.ttlSeconds = 800000;
        // Use orderingType 1 for distance (higher is better)
        leaderboardCreateOptions.orderingType = 1;

        this.leaderboardModule.getLeaderboard(
            leaderboardCreateOptions,
            (leaderboardInstance) => {
                leaderboardInstance.submitScore(
                    distance,
                    (currentUserInfo) => {
                        print('[Leaderboard] Distance score submitted successfully');
                        if (!isNull(currentUserInfo)) {
                            print(`[Leaderboard] User: ${
                                currentUserInfo.snapchatUser.displayName || ''
                            }, Distance: ${currentUserInfo.score}cm`);
                        }
                    },
                    (status) => {
                        print('[Leaderboard] Submit distance failed, status: ' + status);
                    }
                );
            },
            (status) => {
                print('[Leaderboard] getLeaderboard failed, status: ' + status);
            }
        );
    }

    private ensureUiShown() {
        if (this.isUiShown) {
            return;
        }
        this.isUiShown = true;
        this.showUi();
    }

    private ensureUiHidden() {
        if (!this.isUiShown) {
            return;
        }
        this.isUiShown = false;
        this.uiScript.hideUi();
    }

    private updateUi() {
        if (!this.isUiShown) {
            return;
        }
        this.showUi();
    }

    private showUi() {
        switch (this.currentState) {
            case PathWalkerState.None:
                return
            case PathWalkerState.GoToStart:
                this.uiScript.showGoToStartUi(this.pathLength);
                return;
            case PathWalkerState.Walking:
                this.uiScript.showEndSessionUi();
                return;
        }
    }

    private initSlider() {
        if (!this.speedSlider) {
            print("[PathWalker] Warning: Speed slider not assigned");
            return;
        }

        this.sliderComponent = this.speedSlider.getComponent(Slider.getTypeName());
        if (!this.sliderComponent) {
            print("[PathWalker] Warning: Slider component not found on speedSlider object");
            return;
        }

        // Set slider range from 0.5 to 5 for animation speed
        this.sliderComponent.minValue = 0.5;
        this.sliderComponent.maxValue = 5;
        this.sliderComponent.currentValue = 1;
        
        // Add event listener for value changes
        if (this.sliderComponent.onValueUpdate) {
            this.sliderComponent.onValueUpdate.add((value) => {
                this.animationSpeed = value;
            });
        } else {
            print("[PathWalker] Warning: onValueUpdate event is undefined on slider component");
        }

        // Make control panel visible
        if (this.speedControlPanel) {
            this.speedControlPanel.enabled = true;
        }
    }

    /**
     * Starts the animation of the object along the path
     */
    public startAnimation() {
        if (!this.animatedObject) {
            print("[PathWalker] Warning: Animated object not assigned");
            return;
        }
        
        // Place animated object at the start line if available
        if (this.startLineController) {
            this.animatedObject.getTransform().setWorldPosition(this.startLineController.getTransform().getWorldPosition());
        }
        
        // Slow down the animation significantly
        this.animationSpeed = 0.2;
        this.animationPosition = 0;
        this.isAnimating = false;
        
        this.initSlider();
        
        // Use an update loop to wait for 3 seconds before starting the animation
        let delayTime = 3;
        let startTime = getTime(); // assumes getTime() returns time in seconds
        this.createEvent("UpdateEvent").bind(() => {
             if (!this.isAnimating) {
                 let elapsed = getTime() - startTime;
                 if (elapsed >= delayTime) {
                     print("[PathWalker] 3 second delay complete, starting animation update loop");
                     this.isAnimating = true;
                 }
             }
             if (this.isAnimating) {
                 this.updateAnimation();
             }
        });
    }

    /**
     * Updates the animated object's position along the path based on the current animation position and speed
     */
    private updateAnimation() {
        if (!this.isAnimating || !this.animatedObject || !this.pathPoints || this.pathPoints.length < 2) {
            return;
        }
        
        // Update animation position based on speed and delta time
        this.animationPosition += this.animationSpeed * getDeltaTime();
        
        // Loop back to the beginning when reaching the end
        if (this.animationPosition >= 1) {
            if (this.isLoop) {
                this.animationPosition = this.animationPosition % 1;
            } else {
                this.animationPosition = 1;
                this.stopAnimation();
                return;
            }
        }
        
        // Get the interpolated position along the path
        const position = this.getPositionAlongPath(this.animationPosition);
        
        // If we have more than one point, calculate the rotation to face the direction of movement
        let rotation = quat.fromEulerVec(vec3.zero()); // Using quat.fromEulerVec instead of quat.identity
        if (this.pathPoints.length > 1) {
            // Calculate the next position to determine the forward direction
            const nextT = Math.min(this.animationPosition + 0.01, 1);
            const nextPosition = this.getPositionAlongPath(nextT);
            
            // Calculate the direction vector
            const direction = nextPosition.sub(position).normalize();
            
            // Create a rotation that points in the direction of movement
            if (direction.length > 0.001) { // Removed parentheses from length - it's a property, not a method
                rotation = quat.lookAt(direction, new vec3(0, 1, 0)); // Look in the direction of movement with up along Y
            }
        }
        
        // Update the position and rotation of the animated object
        this.animatedObject.getTransform().setWorldPosition(position);
        this.animatedObject.getTransform().setWorldRotation(rotation);
    }

    /**
     * Stops the animation of the object
     */
    public stopAnimation() {
        this.isAnimating = false;
        
        // Hide the speed control panel
        if (this.speedControlPanel) {
            this.speedControlPanel.enabled = false;
        }
    }

    /**
     * Gets a position along the path at the specified normalized position (0 to 1)
     * @param t Normalized position along the path (0 = start, 1 = end)
     * @returns The interpolated position at the specified point along the path
     */
    private getPositionAlongPath(t: number): vec3 {
        // NEW: use the animatedPath if available
        let path = (this.animatedPath && this.animatedPath.length > 0) ? this.animatedPath : (this.pathPoints || []);
        if (path.length === 0) {
            return vec3.zero();
        }
        if (path.length === 1) {
            return path[0];
        }
        
        // Clamp t between 0 and 1
        t = Math.max(0, Math.min(1, t));
        
        // Calculate segment index and local t
        const segmentCount = path.length - 1;
        const segmentIndex = Math.min(Math.floor(t * segmentCount), segmentCount - 1);
        const segmentT = (t * segmentCount) - segmentIndex;
        
        // ...existing code...
        const startPoint = path[segmentIndex];
        const endPoint = path[segmentIndex + 1];
        return vec3.lerp(startPoint, endPoint, segmentT);
    }
}
