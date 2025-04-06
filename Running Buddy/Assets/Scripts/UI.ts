import Event from "../SpectaclesInteractionKit/Utils/Event";
import {Conversions} from "./Conversions";
import { LoopController } from "./LoopController";

@component
export class UI extends BaseScriptComponent {
    @input
    camObj: SceneObject

    @input
    homeUI:SceneObject

    @input
    duringPathCreationUI:SceneObject

    @input
    goToStartUI:SceneObject

    @input
    goToStartUiDistance: Text;

    @input
    endSessionUI:SceneObject

    @input
    pfbLoopUi:ObjectPrefab

    @input
    backplateSo:SceneObject

    @input
    warningTutorialUI:SceneObject

    @input
    tutorialUI:SceneObject

    @input 
    tutorialAnimationPlayer:AnimationPlayer

    @input
    tutorialText:Text

    @input
    leaderboardUI: SceneObject

    // New input for new game button
    @input
    newGameButton: SceneObject

    // NEW: Input for record time display on leaderboard UI
    @input
    recordTime: Text

    // NEW: control panel input for warning tutorial UI
    @input
    controlPanel: SceneObject

    get createPathClicked() {
        return this.createPathClickedEvent.publicApi();
    }

    get resetPathClicked() {
        return this.resetPathClickedEvent.publicApi();
    }

    get finishPathClicked(){
        return this.finishPathClickedEvent.publicApi();
    }

    get loopPathClicked(){
        return this.loopPathClickedEvent.publicApi();
    }

    get tutorialComplete(){
        return this.tutorialCompleteEvent.publicApi();
    }

    get endSessionClicked(){
        return this.endSessionClickedEvent.publicApi();
    }

    // New event for new game click
    get newGameClicked() {
        return this.newGameClickedEvent.publicApi();
    }

    private createPathClickedEvent: Event = new Event();
    private resetPathClickedEvent: Event = new Event();
    private finishPathClickedEvent: Event = new Event();
    private loopPathClickedEvent: Event = new Event();
    private tutorialCompleteEvent: Event = new Event();
    private endSessionClickedEvent: Event = new Event();

    // New event for new game click
    private newGameClickedEvent: Event = new Event();

    private warningTr = null;
    private tutorialTr = null;
    private homeTr = null;
    private duringPathCreationUiTr: Transform = null;
    private goToStartUiTr: Transform = null;
    private endSessionUiTr: Transform = null;
    private currentActiveTr: Transform = null;

    private leaderboardUITr: Transform = null;
    private newGameBtnTr: Transform = null; // new game button transform
    // NEW: control panel transform
    private controlPanelTr: Transform = null;

    private tutorialStepCount:number = 0;

    private loopUiController:LoopController | undefined;

    private leaderboardModule = require('LensStudio:LeaderboardModule');

    onAwake(){
        this.warningTr = this.warningTutorialUI.getTransform();
        this.tutorialTr = this.tutorialUI.getTransform();
        this.homeTr = this.homeUI.getTransform();
        this.duringPathCreationUiTr = this.duringPathCreationUI.getTransform();
        this.goToStartUiTr = this.goToStartUI.getTransform();
        this.endSessionUiTr = this.endSessionUI.getTransform();
        this.leaderboardUITr = this.leaderboardUI.getTransform();

        this.hide(this.leaderboardUITr);
        this.hide(this.tutorialTr);
        this.hide(this.homeTr);
        this.hide(this.duringPathCreationUiTr);
        this.hide(this.goToStartUiTr);
        this.hide(this.endSessionUiTr);

        // New: get new game button transform and hide it
        this.newGameBtnTr = this.newGameButton.getTransform();
        this.hide(this.newGameBtnTr);
        // NEW: get control panel transform (warning tutorial UI will be reparented to it)
        this.controlPanelTr = this.controlPanel.getTransform();
        // Optionally hide control panel if needed:
        // this.hide(this.controlPanelTr);

        // Revert control panel reparenting:
        // Removed: this.controlPanel.setParent(this.camObj);
    }

    showHomeUi(){
        this.tryHideCurrentActive();
        this.currentActiveTr = this.homeTr;
        this.show(this.currentActiveTr);
    }

    showTutorialUi(){
        this.tryHideCurrentActive();
        // Revert warning tutorial UI reparenting:
        // Removed: this.warningTutorialUI.setParent(this.controlPanel);
        this.currentActiveTr = this.warningTr;
        this.show(this.currentActiveTr);
        this.tutorialStepCount = 0;
    }

    showDuringPathCreationUi(){
        this.tryHideCurrentActive();
        this.currentActiveTr = this.duringPathCreationUiTr;
        this.show(this.currentActiveTr);
    }

    showEndSessionUi(){
        this.tryHideCurrentActive();
        this.currentActiveTr = this.endSessionUiTr;
        this.show(this.currentActiveTr);
    }

    showGoToStartUi(distance: number){
        this.tryHideCurrentActive();
        const pathDistFt = Conversions.cmToFeet(distance);
        this.goToStartUiDistance.text = pathDistFt.toFixed(1) + "'";
        this.currentActiveTr = this.goToStartUiTr;
        this.show(this.currentActiveTr);
    }

    showLeaderboardUi(){
        this.tryHideCurrentActive();
        this.currentActiveTr = this.leaderboardUITr;
        this.show(this.currentActiveTr);
    }

    // New method to show leaderboard along with new game button
    showLeaderboardWithNewGame(){
        this.tryHideCurrentActive();
        this.currentActiveTr = this.leaderboardUITr;
        this.show(this.currentActiveTr);
        // NEW: Update record time from leaderboard before showing new game button
        this.updateRecordTime();
        this.show(this.newGameBtnTr);
    }

    // NEW: Method to update record time from leaderboard
    public updateRecordTime() {
        const leaderboardCreateOptions = Leaderboard.CreateOptions.create();
        leaderboardCreateOptions.name = 'RUNNING_BUDDIES_LAP_TIME';
        leaderboardCreateOptions.ttlSeconds = 800000;
        leaderboardCreateOptions.orderingType = 0;
        
        this.leaderboardModule.getLeaderboard(
            leaderboardCreateOptions,
            (leaderboardInstance) => {
                leaderboardInstance.getPersonalBest(
                    (record) => {
                        if (record && record.score) {
                            const timeInMs = record.score;
                            const timeInSec = timeInMs / 1000;
                            this.recordTime.text = timeInSec.toFixed(2) + "s";
                        } else {
                            this.recordTime.text = "N/A";
                        }
                    },
                    (status) => {
                        print("[UI] getPersonalBest failed, status: " + status);
                        this.recordTime.text = "N/A";
                    }
                );
            },
            (status) => {
                print("[UI] getLeaderboard failed, status: " + status);
                this.recordTime.text = "N/A";
            }
        );
    }

    initLoopUi(startTr:Transform){
        if(!this.loopUiController){
            this.loopUiController = this.pfbLoopUi.instantiate(null).getComponent("ScriptComponent") as LoopController;
        }
        this.loopUiController.start(startTr);
    }

    showLoopUi(){
        this.loopUiController.show();
    }

    hideLoopUi(){
        this.loopUiController.hide();
    }

    hideUi(){
        this.tryHideCurrentActive();
        this.currentActiveTr = null;
    }

    onProgressTutorial(){
        if(this.tutorialStepCount === 0){
            this.tryHideCurrentActive();
            this.currentActiveTr = this.tutorialTr;
            this.show(this.currentActiveTr);
        } else if(this.tutorialStepCount === 1){
            this.tutorialAnimationPlayer.setClipEnabled("Sprint_Layer", false);
            this.tutorialAnimationPlayer.setClipEnabled("Loop_Layer", true);
            this.tutorialText.text = "MAKE A LOOP";
        } else if(this.tutorialStepCount === 2){
            this.hide(this.tutorialTr);
            this.tutorialCompleteEvent.invoke();
        }
        this.tutorialStepCount += 1;
    }

    onCreatePathButton(){
        this.hide(this.homeTr);
        this.createPathClickedEvent.invoke();
        //this.hide(this.leaderboardUITr);
    }

    onFinishCreatePathButton(){
        this.hide(this.duringPathCreationUiTr);
        //this.showLeaderboardUi();
        if (this.loopUiController.getIsInLoopZone()) {
            this.loopUiController.onLock();
            this.loopPathClickedEvent.invoke();
        } else {
            // Removed showLeaderboardUi() call since finish button should only trigger finishPathClickedEvent now.
            this.finishPathClickedEvent.invoke();
        }
    }

    onResetCreatePathButton(){
        this.hide(this.duringPathCreationUiTr);
        this.resetPathClickedEvent.invoke();
    }

    onStopWalkingButton(){
        this.hide(this.endSessionUiTr);
        this.endSessionClickedEvent.invoke();
    }

    // New method called by the new game button callback (wired via Inspector)
    onNewGameButton(){
        this.hide(this.newGameBtnTr);
        this.newGameClickedEvent.invoke();
    }

    private hide(tr:Transform){
        let localPos = tr.getLocalPosition();
        localPos.y = 10000;
        tr.setLocalPosition(localPos);
        this.backplateSo.enabled = false;
    }

    private show(tr:Transform){
        // NEW: Use a native vec3 by using the constructor.
        tr.setLocalPosition(new vec3(0, 0, -5));
        this.backplateSo.enabled = true;
    }

    private tryHideCurrentActive(){
        if (this.currentActiveTr){
            this.hide(this.currentActiveTr);
        }
    }
}