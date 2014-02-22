Ext.define("ChartRenderer", function() {

    var self;

    return {

        config : {
            items : [],
            snapshots : [],
        },

        constructor:function(config) {
            self = this;
            this.initConfig(config);
            return this;
         },

        getCalculator : function() {

            Ext.define("MyBurnCalculator", {
                extend: "Rally.data.lookback.calculator.TimeSeriesCalculator",
                acceptedData : [],
                pointsOffset : [],

                getMetrics : function() {
                    var metrics = [];
                    _.each(self.items,function(item){
                        metrics.push({
                            as : item.get("FormattedID")+"-"+"Count",
                            f : 'filteredSum',
                            field : 'LeafStoryCount',
                            filterField : 'FormattedID',
                            filterValues : [item.get("FormattedID")],
                            start : item.get("PlannedStartDate"),
                            end : item.get("PlannedEndDate")
                        });
                        metrics.push({
                            as : item.get("FormattedID")+"-"+"Accepted",
                            f : 'filteredSum',
                            field : 'AcceptedLeafStoryCount',
                            filterField : 'FormattedID',
                            filterValues : [item.get("FormattedID")],
                            start : item.get("PlannedStartDate"),
                            end : item.get("PlannedEndDate")
                        });
                    });
                    metrics.push({
                        as : "Total-Count",
                        f : 'sum',
                        field : 'LeafStoryCount'
                    });
                    metrics.push({
                        as : "Total-Accepted",
                        f : 'sum',
                        field : 'AcceptedLeafStoryCount',
                    });
                    return metrics;
                },

                projectValue : function (start,end,itemid,row, index, summaryMetrics, seriesData) {
                    var that = this;

                    that.acceptedData[itemid] = (that.acceptedData[itemid] == undefined || that.acceptedData[itemid] == null) ? [] : that.acceptedData[itemid];
                    var ad = that.acceptedData[itemid];
                    if (index === 0) {
                        datesData = _.pluck(seriesData,"label");
                        var today = new Date();
                        var li = datesData.length-1;
                        ad = _.pluck(seriesData,itemid+"-Accepted");
                        ad = _.filter(ad, function(d,i) { 
                            return d != null && new Date(Date.parse(datesData[i])) < today; 
                        });
                        
                        // calculate an offset between the projected value and the actual accepted values.
                        var lastAccepted = ad[ad.length-1];
                        var lastProjected = linearProject( ad, ad.length-1);
                        that.pointsOffset[itemid] = lastAccepted-lastProjected;    
                        that.acceptedData[itemid] = ad;
                    }

                    // return null if date for point is outside planned start/end
                    if (start != null && end != null) {
                        var d = new Date(Date.parse(seriesData[index].label));
                        if (d < start || d > end)
                            return null;
                    }

                    var y = linearProject( ad, index) + that.pointsOffset[itemid];
                    return Math.round(y * 100) / 100;
                },

                getDerivedFieldsAfterSummary : function () {
                    var that = this;
                    var fields =
                        _.map(self.items, function(item) {
                            return {
                                start : item.get("PlannedStartDate"),
                                end : item.get("PlannedEndDate"),
                                itemid : item.get("FormattedID"),
                                as : item.get("FormattedID")+"-Projection",
                                f : function (row, index, summaryMetrics, seriesData) {
                                    return that.projectValue(this.start,this.end,this.itemid,row,index,summaryMetrics,seriesData);
                                }
                            };
                        });
                    fields.push({
                        as : "Total-Projection",
                        f : function (row, index, summaryMetrics, seriesData) {
                            return that.projectValue(null,null,"Total",row,index,summaryMetrics,seriesData);
                        }
                    });
                    return fields;
                },
            }
            );

            return Ext.create("MyBurnCalculator");
        },

        getChartConfig : function() {

            var lumenize = window.parent.Rally.data.lookback.Lumenize;
            var snapShotData = _.map(self.snapshots,function(d){return d.data;});
            var calc = self.getCalculator();

            var config = {
                deriveFieldsOnInput: [],
                metrics: calc.getMetrics(),
                summaryMetricsConfig: [],
                deriveFieldsAfterSummary: calc.getDerivedFieldsAfterSummary(),
                granularity: lumenize.Time.DAY,
                tz: 'America/New_York',
                holidays: [],
                workDays: 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'
            };
            //console.log("config df",config.deriveFieldsAfterSummary);

            var start = _.min( _.map(self.items,function(i){return i.get("PlannedStartDate");}));
            var end   = _.max( _.map(self.items,function(i){return i.get("PlannedEndDate");}));
            var startOnISOString = new lumenize.Time(start).getISOStringInTZ(config.tz);
            var upToDateISOString = new lumenize.Time(end).getISOStringInTZ(config.tz);
            // create the calculator and add snapshots to it.
            var calculator = new lumenize.TimeSeriesCalculator(config);
            calculator.addSnapshots(snapShotData, startOnISOString, upToDateISOString);

            // create a high charts series config object, used to get the hc series data
            var hcConfig = [{ name : "label" }];
            _.each( _.map( calc.getMetrics(), function(m) { 
                return {
                    visible : m.as.split("-")[0] != "Total" ? false : true,
                    name : m.as,
                    type : "line",
                    thetitle : m.thetitle
                };
            }), function(c) { hcConfig.push(c);});
            _.each( _.map( config.deriveFieldsAfterSummary, function(m) { 
                return {
                    visible : m.as.split("-")[0] != "Total" ? false : true,
                    name : m.as,
                    type : "line",
                    dashStyle : "dash"
                };
            }), function(c) { hcConfig.push(c);});

            var hc = lumenize.arrayOfMaps_To_HighChartsSeries(calculator.getResults().seriesData, hcConfig);
            var metrics = calc.getMetrics();
            // nullify data values that are outside of the planned start/end date range.
            _.each(metrics,function(m,i){
                var h = hc[i+1];
                _.each(h.data,function(data,x) {
                    var d = Date.parse(hc[0].data[x]);
                    if ((d < m.start) || (d > m.end)) {
                        h.data[x] = null;
                    }
                });
            })
            return hc;
        },

        createChart : function(id,title) {

            var series = self.getChartConfig();
            var tickInterval = series[1].data.length <= (7*20) ? 7 : (series[1].data.length / 20);

            var extChart = Ext.create('Rally.ui.chart.Chart', {
            listeners : {
                // afterrender : function(c,e) {
                //     console.log("this",this);
                //     _.each(this.chartData.series,function(series){
                //         console.log("series",series);
                //         if (series.name.split(",")[0] != "Total")
                //             series.hide();
                //     })
                // }
            },
            columnWidth : 1,
            itemId : id,
            chartData: {
                categories : series[0].data,
                series : series.slice(1, series.length)
            },
            // chartColors: ['Gray', 'Orange', 'Green', 'LightGray', 'Blue','Green'],

            chartConfig : {
                chart: {
                },
                title: {
                text: title,
                x: -20 //center
                },
                plotOptions: {
                    line: {
                        events: { 
                            legendItemClick : 
                                function(a,b,c) {
                                    // hide all other series
                                    var prefix = this.name.split("-")[0];
                                    var series = this.chart.series;
                                    _.each( series, function(s,i) {
                                        var otherPrefix = s.name.split("-")[0];
                                        (prefix===otherPrefix) ? s.show() : s.hide();
                                    });
                                    a.preventDefault();
                                    // set the chart title based on selection.
                                    var item = _.find(self.items,function(i){
                                        return i.get("FormattedID") === prefix;
                                    });
                                    this.chart.setTitle( { text : (item != null ? item.get("Name") : "Total")});
                                }
                            }
                    },
                    series: {
                        marker: {
                            radius: 2
                        }
                    }
                },
                xAxis: {
                    // plotLines : plotlines,
                    //tickInterval : 7,
                    tickInterval : tickInterval,
                    type: 'datetime',
                    labels: {
                        formatter: function() {
                            return Highcharts.dateFormat('%b %d', Date.parse(this.value));
                        }
                    }
                },
                yAxis: {
                    title: {
                        text: 'count'
                    },
                    plotLines: [{
                        value: 0,
                        width: 1,
                        color: '#808080'
                    }]
                },
                tooltip: {
                },
                legend: { align: 'center', verticalAlign: 'bottom' }
            }
        });

        return extChart;

        }
    }
});
