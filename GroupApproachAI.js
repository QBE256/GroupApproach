/*
 行動型のユニットが小隊単位で動くようになるAI

 ■作成者
キュウブ

■概要
CPUが小隊単位で動くようになります。
要は固まっている敵軍を1体ずつ釣りだす戦法が使えなくなります。

具体的には
1.小隊が2体以上いる時
2体以上の小隊ユニットが攻撃可能と判定された時に小隊全員が動き出すようになります
2.小隊が1体しかいない時
1体以上の小隊ユニットが攻撃可能と判定された時に小隊全員が動き出すようになります

また一度行動可能と判定された小隊ユニットは小隊の所属ではなくなり、
次ターン以降、通常のAIと同等の動きをするようになります。

■使い方
1.対象ユニットに以下のカスタムパラメータを設定してください
GroupApproachId:<小隊番号>
ここで同じ番号を持つユニットが同じ小隊に所属していると判定されるようになります。

※ よって、非常に離れた位置にいるCPU同士で同じ番号を設定すると、いつまで経っても動いてくれなくなる可能性があります。
※ 近づいた時に行動してくれるとかどうか逐次デバッグを推奨します。

2.対象ユニットを常時行動型(行動型で範囲内のみ行動は"チェックしない")にする
本AIは行動型にしか対応しておりません。
また、範囲のみ行動の設定は、小隊行動可能と判定されても攻撃範囲内に敵がいないと待機してしまうので推奨はしません。

■注意点
本プラグインではターン開始～CPU行動開始までの間、1フレーム毎に1小隊が行動可能かどうかの計算を行います。
例えば、敵軍の持っているGroupApproachIdが全部で5種類に分別される場合は、5小隊いるので計算に5フレームかかるようになります。
よって、GroupApproachIdの種類が増えれば増える程、ターン開始～CPU行動開始までの間が長くなっていきます。

■更新履歴
ver1.0 2020/06/13
初版

■対応バージョン
SRPG Studio Version:1.161

■規約
・利用はSRPG Studioを使ったゲームに限ります。
・商用・非商用問いません。フリーです。
・加工等、問題ありません。
・クレジット明記無し　OK (明記する場合は"キュウブ"でお願いします)
・再配布、転載　OK (バグなどがあったら修正できる方はご自身で修正版を配布してもらっても構いません)
・wiki掲載　OK
・SRPG Studio利用規約は遵守してください。

*/
(function(){
	var tempFunctions = {
		EnemyTurn: {
			moveTurnCycle: EnemyTurn.moveTurnCycle,
			_prepareTurnMemberData: EnemyTurn._prepareTurnMemberData
		},
		AutoActionBuilder: {
			buildApproachAction: AutoActionBuilder.buildApproachAction
		}
	};

	var validateActiveGroupApproach = function(unit, id, isActive) {
		if (!unit) {
			return false;
		}

		if (typeof unit.custom.GroupApproachId !== 'number') {
			return false;
		}

		if (unit.custom.GroupApproachId !== id) {
			return false;
		}

		if (isActive === true && unit.custom.isGroupApproachActive === true) {
			return true;
		}

		if (isActive === false && unit.custom.isGroupApproachActive !== true) {
			return true;
		}

		return false;
	};

	// 引数で指定されたGroupApproachIdに所属しており、行動フラグが立っていないユニットリストを作成する
	AllUnitList.getGroupApproachNegativeList = function(list, id) {
		var funcCondition = function(unit) {
			return unit.getAliveState() === AliveType.ALIVE && FusionControl.getFusionParent(unit) === null && validateActiveGroupApproach(unit, id, false);
		};
		
		return this.getList(list, funcCondition);
	};

	PlayerList.getGroupApproachNegativeList = function(id) {
		return AllUnitList.getGroupApproachNegativeList(this.getMainList(), id);
	};

	EnemyList.getGroupApproachNegativeList = function(id) {
		return AllUnitList.getGroupApproachNegativeList(this.getMainList(), id);
	};

	AllyList.getGroupApproachNegativeList = function(id) {
		return AllUnitList.getGroupApproachNegativeList(this.getMainList(), id);
	};

	EnemyTurnMode.GROUPCHECK = 61;
	EnemyTurnMode.GROUPAPPROACHCHECK = 62;

	// 敵軍が所持しているGroupApproachIdのリスト
	EnemyTurn._groupApproachIdArray = null;

	// 1フレームにつき、_groupApproachIdArrayの中の1つの要素を参照して計算を行うので
	// 現フレームでどのインデックスを参照すべきかこの変数に記す
	EnemyTurn._groupApproachIdCurrentIndex = 0;
	EnemyTurn._prepareTurnMemberData = function() {
		this._groupApproachIdArray = [];
		this._groupApproachIdArrayCurrentIndex = 0;
		tempFunctions.EnemyTurn._prepareTurnMemberData.call(this);
	};

	// 初期状態をEnemyTurnMode.GROUPCHECKにする
	EnemyTurn._completeTurnMemberData = function() {
		this._straightFlow.setStraightFlowData(this);
		this._pushFlowEntries(this._straightFlow);
		
		this._resetOrderMark();
		this.changeCycleMode(EnemyTurnMode.GROUPCHECK);
		
		// 自軍ターン終了時に援軍などが登場している可能性があるため、
		// 敵ターン開始にマーキングを実行する
		MapLayer.getMarkingPanel().updateMarkingPanel();
	};

	EnemyTurn.moveTurnCycle = function() {
		var mode = this.getCycleMode();
		var result = MoveResult.CONTINUE;

		if (mode === EnemyTurnMode.GROUPCHECK) {
			return this._moveGroupCheck();
		}
		else if (mode === EnemyTurnMode.GROUPAPPROACHCHECK) {
			return this._moveGroupApproachCheck();
		}
		else {
			return tempFunctions.EnemyTurn.moveTurnCycle.call(this);
		}
	};

	EnemyTurn._moveGroupCheck = function() {

		// 1フレーム丸々消費してGroupApproachIdリストを作成する
		this._createGroupList();
		this.changeCycleMode(EnemyTurnMode.GROUPAPPROACHCHECK);
		
		return MoveResult.CONTINUE;
	};

	EnemyTurn._moveGroupApproachCheck = function() {
		// 1フレームにつき1つのGroupApproachIdの行動可否をチェックする
		// よって、GroupApproachIdの数が多い程、敵ターン開始から1体目の敵行動開始までの間が空くようになる
		if (this._groupApproachIdArrayCurrentIndex < this._groupApproachIdArray.length) {
			this._calculateEnableGroupApproach(this._groupApproachIdArray[this._groupApproachIdArrayCurrentIndex]);
			this._groupApproachIdArrayCurrentIndex++;
		}
		
		// 全てのGroupApproachIdの行動可否をチェックしたら通常の敵ターン処理に移行
		if (this._groupApproachIdArrayCurrentIndex >= this._groupApproachIdArray.length) {
			this.changeCycleMode(EnemyTurnMode.TOP);
		}
		
		return MoveResult.CONTINUE;
	};

	EnemyTurn._createGroupList = function() {
		var unit, i;
		var list = TurnControl.getActorList();
		var count = list.getCount();

		for (i = 0; i < count; i++) {
			unit = list.getData(i);
			if (typeof unit.custom.GroupApproachId === 'number' && this._groupApproachIdArray.indexOf(unit.custom.GroupApproachId) === -1) {
				this._groupApproachIdArray.push(unit.custom.GroupApproachId);
			}
		};
	};

	EnemyTurn._calculateEnableGroupApproach = function(id) {
		var unit, i;
		var list = this._getGroupApproachNegativeList(id);
		var count = list.getCount();
		var isEnableAttackCount = 0;

		for (i = 0; i < count; i++) {
			unit = list.getData(i);

			if (CombinationManager.getApproachCombination(unit, true)) {
				isEnableAttackCount++;
			}

			if (isEnableAttackCount >= 2) {
				break;
			}
		};

		// グループユニットが一体しかいない時は、行動可能とする
		// グループユニットが二体以上の時は二人以上の攻撃範囲に属した場合に行動可能とする
		if ((count === 1 && isEnableAttackCount === 1) || (count > 1 && isEnableAttackCount >= 2)) {
			unit.custom.isGroupApproachActive = true;

			// カスパラを導入する事で行動可能フラグを立てる
			for (i = 0; i < count; i++) {
				unit = list.getData(i);
				unit.custom.isGroupApproachActive = true;
			}
		}
	};

	EnemyTurn._getGroupApproachNegativeList = function(id) {
		var turnType = root.getCurrentSession().getTurnType();

		if (turnType === TurnType.ENEMY) {
			return EnemyList.getGroupApproachNegativeList(id);
		}
		else if (turnType === TurnType.ALLY) {
			return AllyList.getGroupApproachNegativeList(id);
		}

		return PlayerList.getGroupApproachNegativeList(id);
	};

	AutoActionBuilder.buildApproachAction = function(unit, autoActionArray) {
		if (typeof unit.custom.GroupApproachId === 'number' && unit.custom.isGroupApproachActive !== true) {
			return this._buildEmptyAction();
		}
		else {
			return tempFunctions.AutoActionBuilder.buildApproachAction.call(this, unit, autoActionArray);
		}
	};
})();