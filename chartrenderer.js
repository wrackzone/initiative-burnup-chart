Ext.define("ChartRenderer", function() {

    var self;

    return {

        config : {
            items : [],
            snapshots : [],
            // calculator : null
        },

        constructor:function(config) {
            self = this;
            this.initConfig(config);
            return this;
         },

        getCalculator : function() {

            Ext.define("MyBurnCalculator", {
                extend: "Rally.data.lookback.calculator.TimeSeriesCalculator",

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
                    return metrics;
                },

                projectValue : function (itemid,row, index, summaryMetrics, seriesData) {
                    var that = this;
                    if (index === 0) {
                        datesData = _.pluck(seriesData,"label");
                        var today = new Date();
                        var li = datesData.length-1;
                        acceptedPointsData = _.pluck(seriesData,itemid+"-Accepted");
                        acceptedPointsData = _.filter(acceptedPointsData, function(d,i) { return new Date(Date.parse(datesData[i])) < today; });
                        
                        // calculate an offset between the projected value and the actual accepted values.
                        var lastAccepted = acceptedPointsData[acceptedPointsData.length-1];
                        var lastProjected = linearProject( acceptedPointsData, acceptedPointsData.length-1);
                        that.pointsOffset = lastAccepted-lastProjected;    
                    }
                    var y = linearProject( acceptedPointsData, index) + that.pointsOffset;
                    return Math.round(y * 100) / 100;
                },

                getDerivedFieldsAfterSummary : function () {
                    return _.map(self.items, function(item) {
                        console.log("-item",item);
                        return {
                            // item : item,
                            itemid : item.get("FormattedID"),
                            as : item.get("FormattedID")+"-Projection",
                            f : function (row, index, summaryMetrics, seriesData) {
                                console.log("this",this);
                                // return 0;
                                return self.projectValue(this.itemid,row,index,summaryMetrics,seriesData);
                            }
                        };
                    });
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
            console.log("config df",config.deriveFieldsAfterSummary);

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
                    name : m.as,
                    type : "line",
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
                            legendItemClick : function(a,b,c) {
                                var prefix = this.name.split("-")[0];
                                var series = this.chart.series;
                                var seriesIndex = this.index;
                                _.each( series, function(s,i) {
                                    if (i!=seriesIndex) {
                                        var otherPrefix = s.name.split("-")[0];
                                        if (prefix===otherPrefix)
                                            series[i].visible ? series[i].hide() : series[i].show();
                                    }

                                });
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
