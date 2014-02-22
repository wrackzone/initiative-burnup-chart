var app = null;

Ext.define('CustomApp', {
	extend: 'Rally.app.App',
	componentCls: 'app',
	items:{ 
		// html:'<a href="https://help.rallydev.com/apps/2.0rc2/doc/">App SDK 2.0rc2 Docs</a>'
	},

	config: {
		defaultSettings: {
			itemtype : 'Initiative',
			items : '',
			unittype : 'Count'
		}
	},

	getSettingsFields: function() {
		return [
			{
				name: 'itemtype',
				xtype: 'rallytextfield',
				label : "Item Type eg. 'Initiaitve'"
			},
			{
				name: 'items',
				xtype: 'rallytextfield',
				label : "Portfolio Items (comma separated)"
			},
			{
				name: 'unittype',
				xtype: 'rallytextfield',
				label : "'Points' or 'Count'"
			}
		];
	},

	launch: function() {
		//Write app code here
		console.log("launch");
		app = this;

		var items = app.getSetting('items').split(",");
		app.itemtype = app.getSetting('itemtype');
		var unittype = app.getSetting('unittype');

		items = items != "" ? items : ['I2921','I2912','I2968','I2962']; // ['F1123','F1217','F1215','F1220'];
		if (items=="")
			return;

		// read the features
		var configs = _.map( items,function(item) {
			return {
				model : "PortfolioItem/" + app.itemtype,
				fetch : ["FormattedID","ObjectID","Name","PlannedStartDate","PlannedEndDate"],
				filters: [{ property : "FormattedID", operator : "=", value : item}]
			};
		});	

		app.myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Please wait..."});
		app.myMask.show();

		async.map( configs, app.wsapiQuery,function(err,results) {

			var pis = _.map(results,function(r){ return r[0];});
			console.log("pis",pis);

			if (app.validateItems(items,pis)===false)
				return;

			async.map( [items], app.snapshotquery, function(err,results) {

				console.log("snapshots",results[0].length);

				var renderer = Ext.create("ChartRenderer", {
					items : pis,
					snapshots : results[0]
				});

				var chart = app.down("#chart1");
				if (chart !== null)
					chart.removeAll();
				chart = renderer.createChart("chart1","Initiative Progress");

				app.add(chart);
				chart = app.down("#chart1");
				var p = Ext.get(chart.id);
				elems = p.query("div.x-mask");
				_.each(elems, function(e) { e.remove(); });
				var elems = p.query("div.x-mask-msg");
				_.each(elems, function(e) { e.remove(); });

				app.myMask.hide();
			});
		});
	},

	validateItems : function ( ids,items ) {
		var valid = true;

		if (items===null||items===undefined) {
			console.log("items not found");
			app.myMask.hide();
			Rally.ui.notify.Notifier.show({ message : "Items Not found!" });
			valid = false;
		}


		_.each( items, function(item,x) {
			if (item===undefined||item===null) {
				console.log("id not found",ids[x]);
				app.myMask.hide();
				Rally.ui.notify.Notifier.show({
					message: ids[x] + " Not found!"
				});
				valid = false;
			}
			if (item!== undefined) {
				if ((item.get("PlannedStartDate")===null)||(item.get("PlannedEndDate")===null)) {
					console.log("no start or end date ",ids[x]);
					app.myMask.hide();
					Rally.ui.notify.Notifier.show({
						message: ids[x] + " does not have a planned start or end date!"
					});
					valid = false;
				}
			}
		});

		return valid;

	},

	// generic function to perform a web services query    
	wsapiQuery : function( config , callback ) {
		Ext.create('Rally.data.WsapiDataStore', {
			autoLoad : true,
			limit : "Infinity",
			model : config.model,
			fetch : config.fetch,
			filters : config.filters,
			listeners : {
				scope : this,
				load : function(store, data) {
					callback(null,data);
				}
			}
		});
	},

	snapshotquery : function(items,callback) {

		// console.log(app.getContext().getProject().ObjectID);
		console.log("Snapshotquery for Items",items);

		var storeConfig = {
			find : {
				'_TypeHierarchy' : { "$in" : ["PortfolioItem/"+app.itemtype] },
				'FormattedID' : { "$in" : items },
				'_ProjectHierarchy' : { "$in": app.getContext().getProject().ObjectID }
			},
			autoLoad : true,
			pageSize:1000,
			limit: 'Infinity',
			fetch: ['FormattedID','_UnformattedID','ObjectID','_TypeHierarchy','PreliminaryEstimate', 'LeafStoryCount','LeafStoryPlanEstimateTotal','AcceptedLeafStoryPlanEstimateTotal','AcceptedLeafStoryCount','PercentDoneByStoryCount','Name'],
			hydrate: ['_TypeHierarchy']
		};

		storeConfig.find['FormattedID'] = { "$in": items };
		// storeConfig.find['_ProjectHierarchy'] = { "$in": this.project };
		// storeConfig.find['_ValidTo'] = { "$gte" : isoStart  };
		storeConfig.listeners = {
			scope : this,
			load: function(store, data, success) {
				callback(null,data);
			}
		};
		var snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', storeConfig);
	}
});
