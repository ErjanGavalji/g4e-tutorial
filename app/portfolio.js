const RestServerUrl = 'http://localhost:22910/';
const RestServerEndpoint = 'GetDemoPortfolio';
const StreamName = 'T42.MarketStream.Subscribe';

let detachedTabs = [];
let subscriptions = [];
let _query;
let partyObj;

let serviceMetricsSystem;
let serviceErrorCount;
let lastServiceError;
let serviceLatency;
let logger;

// TUTOR_TODO Chapter 1.2 - Call the Glue factory function and pass in the `glueConfig` object, which is registered by `tick42-glue-config.js`
// When the promise is resolved, attach the received glue instance to `window` so it can be globally accessible
// Then add all of the following code, leave the code under TUTOR_TODO Chapter 8 commented as you will need it later on:
// Glue()
//     .then((glue) => {
//         window.glue = glue;
//         instrumentService();
//         onInitializeApp();
//         initInstrumentSearch();
//         trackTheme();
//     })
//     // Don't forget to catch any errors.
//     .catch((err) => console.log(err));

(async () => {
    try {
        const glue = await Glue();
        window.glue = glue;
        await instrumentService();
        onInitializeApp();
        initInstrumentSearch();
        trackTheme();

        // // TUTOR_TODO Chapter 8
        const glue4OfficeOptions = {
            glue,
            outlook: true,
            // TUTOR_TODO Chapter 9 
            excel: true
        };

        // // TUTOR_TODO Chapter 8 - Initiate Glue4Office with the supplied glue4OfficeOptions then assign the returned g4o object to the window in order to be globally accessible
        const g4o = await Glue4Office(glue4OfficeOptions);
        window.g4o = g4o;
    } catch (error) {
        console.log(error);
    }
})();

const instrumentService = async () => {
    // TUTOR_TODO Chapter 12 - create sub-logger
    logger = glue.logger.subLogger('portfolioLogger');

    // TUTOR_TODO Chapter 12 - create a metrics instance, a sub-system and set the state to GREEN
    serviceMetricsSystem = await glue.metrics.subSystem('Module', 'Portfolio Metrics');
    serviceMetricsSystem.setState(0);
    
    // TUTOR_TODO Chapter 12 - create an error count metric
    serviceErrorCount = await serviceMetricsSystem.countMetric({
        name: 'portfolioErrorCounts',
        description: 'Number of errors',
    }, 0);

    // TUTOR_TODO Chapter 12 - create a composite error metric
    lastServiceError = await serviceMetricsSystem.objectMetric('lastError', {});

    // TUTOR_TODO Chapter 12 - create a TimeSpan metric
    serviceLatency = await serviceMetricsSystem.timespanMetric('portfolioLatencyMetrics');
};

const onInitializeApp = () => {

    setUpAppContent();
    setUpStreamIndicator();
    setUpGlueIndicator();
    setUpWindowEventsListeners();
    setUpTabControls();
};

const initInstrumentSearch = () => {

    // TUTOR_TODO Chapter 6

    // Create a search client using the supplied options

    const gssOptions = {
        agm: glue.agm,
        defaultQueryLimit: 500,
        measureLatency: false,
        searchTimeoutInMillis: 10000,
        debugGss: false,
        debug: false
    };

    const searchClient = new gssClientSearch.create(gssOptions);
    // Use the created search client to create a query for 'Instrument'
    const searchQuery = searchClient.createQuery('Instrument');
    // subscribe to the created query's onData event and call displayResult() passing in the received entities
    searchQuery.onData((data) => displayResult(data));
    _query = searchQuery;
};

const trackTheme = () => {
    const setTheme = (name) => {
        $('#themeLink').attr('href', '../lib/themes/css/' + name);
    }

    // TUTOR_TODO 10 - subscribe for context changes and call setTheme with either 'bootstrap-dark.min.css' or 'bootstrap.min.css'
    glue.contexts.subscribe("theme", (theme) => {
        if (theme.name === 'dark') {
            setTheme('bootstrap-dark.min.css');
        } else if (theme.name === 'light') {
            setTheme('bootstrap.min.css');
        }
    })

};

const setUpAppContent = () => {
    // TUTOR_TODO chapter 4.3 - Check whether the current window context contains the attribute 'party'
    // if doesn't, then go ahead and register the AGM method, otherwise the title of the tab and the window, using the preferredName from the party object
    // and call loadPortfolio() passing in the pId from the party object
    // assign the received party object to partyObj, because we will need it later on.

    const party = glue.windows.my().context.party;
    partyObj = party;

    if (party) {
        glue.windows.my().setTitle(party.preferredName)
        document.getElementById('title').textContent = party.preferredName;

        loadPortfolio(party.pId);
    } else {
        registerAgmMethod();
    }

};

const registerAgmMethod = () => {

    // TUTOR_TODO Chapter 11 - register the AGM method only if you are not in activity, otherwise listen for activity context changes and call loadPortfolio
    if (glue.activities.inActivity) {
        glue.activities.my.onContextChanged((context) => {
            if (context.party) {
                loadPortfolio(context.party.pId);
            }
        });
    } else {
        // TUTOR_TODO Chapter 2.1 - register an AGM method 'SetParty', which accepts a composite argument 'party' with optional strings pId and ucn
        // in the callback - call loadPortfolio passing the pId received as a parameter.
        // assign the received party object to partyObj, because we will need it later on.

        glue.agm.register({
                name: 'SetParty',
                displayName: 'Set Party',
                description: 'Switches the applicaiton window to work with the specified party',
                accepts: 'Composite: {String pId, String ucn} party',
            },
            (party) => {
                loadPortfolio(party.pId);
                partyObj = party;
            });
    }
};

const loadPortfolio = (portf) => {
    const serviceUrl = RestServerUrl + RestServerEndpoint;

    const serviceRequest = 'xpath=//Portfolios/Portfolio[id=' + portf + ']';

    const requestStart = Date.now();

    // TUTOR_TODO Chapter 12 - start the latency metric
    console.log(serviceLatency);
    serviceLatency.start();
    const ajaxOptions = {
        method: 'GET',
        url: serviceUrl,
        data: serviceRequest
    };

    $.ajax(ajaxOptions)
        .done((portfolio) => {
            // TUTOR_TODO Chapter 12 - stop the latency metric
            serviceLatency.stop();
            console.info('request successful')

            const elapsedMillis = Date.now() - requestStart;

            if (elapsedMillis >= 1000) {
                const message = 'Service at ' + serviceUrl + ' is lagging';

                // TUTOR_TODO Chapter 12 - set system state to AMBER and pass the created message
                serviceMetricsSystem.setState(50, message);
            } else {
                // TUTOR_TODO Chapter 12 - set the system state to GREEN
                serviceMetricsSystem.setState(0);
            }

            let parsedPortfolio;
            if (typeof portfolio !== 'undefined') {
                parsedPortfolio = JSON.parse(portfolio);
            }

            const logMessage = {
                portfolioId: portf,
                portfolio: parsedPortfolio
            };

            // TUTOR_TODO Chapter 12 - log to the console using the logger and the provided logMessage
            logger.log(logMessage);
            if (!parsedPortfolio.Portfolios.hasOwnProperty('Portfolio')) {
                console.warn('The client has no portfolio')
                return;
            }

            setupPortfolio(parsedPortfolio.Portfolios.Portfolio.Symbols.Symbol);
            unsubscribeSymbolPrices();
            subscribeSymbolPrices();
        })
        .fail(function (jqXHR, textStatus) {
            // TUTOR_TODO Chapter 12 - stop the latency metric
            serviceLatency.stop();

            // TUTOR_TODO Chapter 12 - increment the error count
            serviceErrorCount.increment();

            const errorMessage = 'Service at ' + serviceUrl + ' failed at ' + serviceRequest + ' with ' + textStatus;

            const errorOptions = {
                clientId: portf,
                message: errorMessage,
                time: new Date(),
                stackTrace: ''
            };

            // TUTOR_TODO Chapter 12 - capture the error with the composite metric and use the provided errorOptions object
            lastServiceError = serviceMetricsSystem.objectMetric('lastError', errorOptions);

            // TUTOR_TODO Chapter 12 - set the system state to RED and pass the provided error message
            serviceMetricsSystem.setState(100, errorMessage);
        })
}

const subscribeSymbolPrices = () => {
    const trs = document.querySelectorAll('#portfolioTableData tr');

    trs.forEach((tr) => {
        const symbol = tr.getAttribute('id');

        subscribeBySymbol(symbol, updateInstruments)
    })
}

const unsubscribeSymbolPrices = () => {

    // TUTOR_TODO Chapter 3 - Traverse the saved subscriptions and close each one.
    // We need to do this, because when the portfolio changes, we need to clear the existing subscriptions and subscribe to the new symbol's subscriptions
    subscriptions.forEach((subscription) => subscription.close());
    subscriptions = [];

}

const subscribeBySymbol = async (symbol, callback) => {

    // TUTOR_TODO Chapter 3 - Subscribe to a stream called 'T42.MarketStream.Subscribe'
    // as a second parameter pass an options object with an `arguments` property, which has a property 'Symbol' and assign to it the symbol variable passed to this function
    // When the promise is resolved save the created stream so that you can later close it and subscribe to new subscriptions (when the portfolio changes)
    // Finally subscribe to the created stream's onData event and invoke the callback passed to this function with the received streamData
    const subscription = await glue.agm.subscribe(StreamName, {
        arguments: {
            Symbol: symbol,
        }
    });
    subscriptions.push(subscription);
    subscription.onData((streamData) => callback(streamData));

    // .then((subscription) => {
    //     subscriptions.push(subscription);
    //     subscription.onData((streamData) => callback(streamData));
    // })
    // .catch((err) => console.log(err));

}

const addRow = (table, rowData, notEmptyFlag) => {
    notEmptyFlag = notEmptyFlag || false;
    const row = document.createElement('tr');

    addRowCell(row, rowData.RIC || '');
    addRowCell(row, rowData.Description || '');
    addRowCell(row, rowData.bid || '', 'text-right');
    addRowCell(row, rowData.ask || '', 'text-right');

    row.onclick = function () {
        if (!notEmptyFlag) {
            removeChildNodes('methodsList');
        }

        // TUTOR_TODO Chapter 2.3 - Discover all registered methods with objectType 'Instrument'
        // invoke addAvailableMethods(*discovered methods*, rowData.RIC, rowData.BPOD)
        const foundMethods = glue.agm.methods().filter((method) => method.objectTypes.find((type) => type === 'Instrument'));

        addAvailableMethods(foundMethods, rowData.RIC, rowData.BPOD);


        row.setAttribute('data-toggle', 'modal');
        row.setAttribute('data-target', '#instruments');
    }
    row.setAttribute('id', rowData.RIC);
    table.appendChild(row);
};

const addRowCell = (row, cellData, cssClass) => {
    var cell = document.createElement('td');
    cell.innerText = cellData;

    if (cssClass) {
        cell.className = cssClass;
    }
    row.appendChild(cell);
};

const setupPortfolio = (portfolios) => {
    // Updating table with the new portfolio
    const table = document.getElementById('portfolioTable').getElementsByTagName('tbody')[0];

    // Removing all old data
    removeChildNodes('portfolioTableData');

    portfolios.forEach((item) => {
        addRow(table, item);
    });
};

const removeChildNodes = (elementId) => {
    const methodsList = document.getElementById(elementId);

    while (methodsList && methodsList.firstChild) {
        methodsList.removeChild(methodsList.firstChild);
    }
};

const updateInstruments = (streamData) => {
    const data = JSON.parse(streamData.data.data)[0];
    const symbol = data.name;
    const prices = data.image || data.update;

    if (!symbol || !prices) {
        return
    }

    const bid = prices.BID;
    const ask = prices.ASK;

    const symbolRow = document.getElementById(symbol);

    if (symbolRow !== null) {
        const symbolRows = symbolRow.getElementsByTagName('td');
        symbolRows[2].innerHTML = bid || 0;
        symbolRows[3].innerHTML = ask || 0;
    }
};

const addAvailableMethods = (methods, symbol, bpod) => {
    const methodsList = document.getElementById('methodsList');
    methods.forEach((method) => {
        const button = document.createElement('button');
        button.className = 'btn btn-default';
        button.setAttribute('type', 'button');
        button.setAttribute('data-toggle', 'tooltip');
        button.setAttribute('data-placement', 'bottom');
        button.setAttribute('title', method.displayName || method.name);
        button.textContent = method.displayName || method.name;

        button.onclick = (event) => {

            const options = {
                instrument: {
                    ric: symbol,
                    bpod: bpod
                }
            };

            invokeAgMethodByName(method.name, options);
        }

        methodsList.appendChild(button);
    })
    console.log(methodsList.children[0].title);

    // Enable tooltip
    $(function () {
        $('[data-toggle="tooltip"]').tooltip()
    })
};

const invokeAgMethodByName = (methodName, params) => {
    // TUTOR_TODO 2.3 invoke the agm method with the passed methodName and passed params
    glue.agm.invoke(methodName, params, 'all');
};

const displayResult = (result) => {
    removeChildNodes('resultInstrumentTbl');

    const resultInstrumentTbl = document.getElementById('resultInstrumentTbl');

    result.forEach((item) => {
        addTickerRow(resultInstrumentTbl, item);
    });

    $('#searchResult').modal('show');
};

const addTickerRow = (table, item) => {

    const row = document.createElement('tr');
    const portfolioTableDataTbl = document.getElementById('portfolioTableData');

    addRowCell(row, item.RIC || '');
    addRowCell(row, item.Description || '');

    row.onclick = () => {
        addRow(portfolioTableDataTbl, item);
        $('#searchResult').modal('hide');
    }

    table.appendChild(row);

    subscribeBySymbol(item.RIC, updateInstruments);
};

const getCurrentPortfolio = () => {
    const portfolio = [];
    const portfolioTableRows = document.querySelectorAll('#portfolioTableData tr');

    portfolioTableRows.forEach((row) => {
        const symbol = {};
        const tds = row.childNodes;

        tds.forEach((td, index) => {
            switch (index) {
                case 0:
                    symbol.ric = td.textContent;
                    break;
                case 1:
                    symbol.description = td.textContent;
                    break;
                case 2:
                    symbol.bid = td.textContent;
                    break;
                case 3:
                    symbol.ask = td.textContent;
                    break;
            }
        })
        portfolio.push(symbol);
    });

    return portfolio;
};

const setUpStreamIndicator = () => {

    const toggleStreamAvailable = (available) => {
        toggleStatusLabel('priceSpan', 'Price feed is', available);
    };

    glue.agm.methodAdded((method) => {
        if (method.name === StreamName && method.supportsStreaming) {
            toggleStreamAvailable(true);
        }
    });

    glue.agm.methodRemoved((method) => {
        if (method.name === StreamName && method.supportsStreaming) {
            toggleStreamAvailable(false);
        }
    });
};

const setUpGlueIndicator = () => {
    const toggleGlueAvailable = (available) => {
        toggleStatusLabel('glueSpan', 'Glue is', available);
    };

    glue.connection.connected(() => {
        toggleGlueAvailable(true);
    });

    glue.connection.disconnected(() => {
        toggleGlueAvailable(false);
    });
};

const toggleStatusLabel = (elementId, text, available) => {
    const span = document.getElementById(elementId);

    if (available) {
        span.classList.remove('label-warning');
        span.classList.add('label-success');
        span.textContent = text + ' available';
    } else {
        span.classList.remove('label-success');
        span.classList.add('label-warning');
        span.textContent = text + ' unavailable';
    }
};

const setUpWindowEventsListeners = () => {

    // TUTOR_TODO Chapter 4.2 - subscribe to the onWindowRemoved event and implement the handler
    // compare the closed window's id with the client window id you were passed on window creation
    // if they match - glue.windows.my().close();
    glue.windows.onWindowRemoved((closedWindow) => {
        const parentWindowId = glue.windows.my().context.parentWindowId;

        if (closedWindow.id === parentWindowId) {
            glue.windows.my().close();
        }
    });
};

const setUpTabControls = () => {
    // TUTOR_TODO Chapter 4.4 - when if the current window is a tab, if it is not return, because in this case we do not need any tab controls.
    const myWindow = glue.windows.my();
    if (myWindow.mode !== "Tab") {
        return;
    }
    // TUTOR_TODO Chapter 4.4 - we have prepared for you the config objects for both buttons.
    const gatherTab = {
        buttonId: 'gatherTabs',
        tooltip: 'Gather all tabs',
        order: 0,
        imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAIAAAAB6CAYAAAB3N1u0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAAYdEVYdFNvZnR3YXJlAHBhaW50Lm5ldCA0LjAuOWwzfk4AAAOlSURBVHhe7d1NaxNRFMbxfpoL7vyA+QpuXfkKVRdKdSWodKMg7tyIUIQ2xdF2TK2TmdS+kFLP5J5FkKo3sXNy5zzPD4YsPWfu35dpY7pm5eLiIhRF8XQ4HG4iX/t7ew/ae6G3xb92WbkGP4+OjuSVooHeHt9k0XB+fn4n7kxz/AcgS4azs7NHcV/6je8AZMFwfHz8LO5Kl/AbgCwXJpPJq7gn/YHPAGSxMB6P38Ud6S/8BSBLhaqqPsb96B98BSALtb/zv8bdKIGPAGSR2TO+POLXs7Wu0Liqdna2t9/05arr+ruOnqL/AcgS7eHfnq3TjV7dpHK/vK9zp+h3ALJAmE6nD+MunWEAOZLhw8nJyUbco1MMIDcyeJC/71/EHTrHAHIiQwf5h87bOL8JBpALGbh9xv8QZzfDAHIgw7bP+LtxblMMYJVkyNkzftM0P2Yj22MAqyIDdv2Mn4IBrIIM1z7jr8c5V4oBWJPBwunp6ZM448oxAEsyVPuM/zzOlwUGYEUGap/xX8fZssEALMgwYVxV7+NcWWEAFuTwt3Wo3DAACzpQjhiABR0oRwzAgg6UIwZgQQfKEQOwoAPliAFY0IFyxAAs6EA5YgAWdKAcMQALOlCOGIAFHSgrk6ap5KVXn6KBEMAtuQZGV+8+QmU0Gt2VuVP1MoBe/ZFsTe7P7C10iVc+gcswqRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRiAR3q4KRjAnIODg2uHh4c3r/KaTCY35D7bfp8gnm0SBjBnNBp19d/nbe+z/qIpGMAcBgCOAYBjAOAYADgGAI4BgGMA4BgAOAYAjgGAYwDgGAA4BgCOAYBjAOAYADgGAI4BgGMA4BgAOAYAjgGAYwDgGEBmZL5FPqXrv6+maTbltQuWH8c3cBGAzNb+bONPcUxahJcA2pppCQwAHAMAxwDAMQBwDAAcAwDHAMAxAHAMABwDAMcAwDEAcAwAHAMAxwDAMQBwDACclwBCXdf7cUxahIsAWjIf3xS6xOUmAGt8Wzg4BgCOAYBjAOAYADgGAI4BgGMA4BgAOAYAjgGAYwDgGAA4BgAOMQDT71MbXwv/yHbEANz6Vpb39HYkYwCOFJ+LDb0dyRiAIwwAHAMAxwDAMQBwDAAcAwD3pSge6+1I5imAy74yhnYt/JXAra2t67vD3ZdXeZVlub7MLMtbW/sFpubVd+W6GFMAAAAASUVORK5CYII='
    };

    const extractTab = {
        buttonId: 'extractTabs',
        tooltip: 'Extract all tabs',
        order: 0,
        imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAIAAAABjCAYAAABT7gjnAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMDY3IDc5LjE1Nzc0NywgMjAxNS8wMy8zMC0yMzo0MDo0MiAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIDIwMTUgKFdpbmRvd3MpIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjM2NDE2QTIxQTkyODExRTY4QUY2RTYzRjNEM0ZFRTJBIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjM2NDE2QTIyQTkyODExRTY4QUY2RTYzRjNEM0ZFRTJBIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6MzY0MTZBMUZBOTI4MTFFNjhBRjZFNjNGM0QzRkVFMkEiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6MzY0MTZBMjBBOTI4MTFFNjhBRjZFNjNGM0QzRkVFMkEiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7pl9TZAAAEm0lEQVR42uydW08aQRiGnXHDIRViaClNuCgJralpjIXEi/4B/7fXpmurpiSgiRdthdBKcQ2nwk4HgxWJWA6z7Hwz73vljbvMvM93GlaXCSHWIOW621Sm+wfl8CoA9++jSozBAACQEQAAIAAA1kMgAAAkAAAkAAAUekkAAJZnAwBgOQQAwPKSAAAszwYAwHIIAIDlJQEAWJ4NAIDlEDiTN/E8r3RxcdHpdrtRnQC5urqq7e/vf5Q/RgGBuucM2N1X19L4r61WK5/JZCK6rVqa39/Y2PgeiURyJFwSwmdSAd9GyfVvI7xer7uJRGJbR/Nd1/2eSqX6VMynVhLYYDD4xTlP6bjCk5OTo52dnSI1U4ZPBK0gAyjJBkxo+lBgrVY7khmpqFu0jfZrxf4GB4F2APi+v9br9c5jsdgbHczW0WmVEGg1BjYajb7c81oI5ouR3/6D3aRl/r91kARAjp7tzc3N9vr6+qvVNuz3phM0fOkGUQsAzs/Pb3K53DDdJlcYJcIw0xeCIHQAyuWyl8/nhwdSz3RLj4ZAILRtAmXab8nIH0IYpzAzExfTCoBqtfpHjnk9mYE3YHx4EIQCwHDUk/rJOU/D/HBBcOb9zWazOXAc52yZu8fj8ecBmi9G8ztsfjo42EIAdDqdgUzd73TufBncnxkCbtiCoDn3jMN8u8VhvoVhf9/3ky8BMH+BPRv1SIx6BoD5CrI+h/l2zv+UAYD589X7Jx8k5YQXBM0S8uy2z5t6LuJQ8x9nPMulfMoZAJGvIOWTBQCpX03Kp1oCQkv9I+7E2AazWWAN6fuIue/pEIn+tSD3887kCdPYyPBFLulTMJ8KAMqjfyJCyX55OLaOhRdgzV8Hj7cQY3WS9Egxb72nCIBQESVjYU7e9GVTvjUZYMx4borp84541HuApaJ/ZLyJI55ScQK0L5IaTTwuDGRNumaARTt/U8+JA1sXxybZU++NA2BVm0R1xKNaAsSs5pvY6K0aaE418k0zP6xsxjXciFnMR8o3FID/dv/Lnn2jgaVfAmC+qQDMcPiDI13DpwBmQ+Tr1MByzTZmWrSYlPa1WotOAIgnmj6kfEtKgJGpX+czC90zgAmpX+s1aAPAIwMAIxzxjMoaHA03DY2erVOAiSMfAIAAwCwtQKFQ6CL6Z9LAOABkA9g8ODjowfyn1ev1LlzXrRoHgOz/oslkMgqLp2v4XqdIJPI6m82+MLEEDP9ZNACYouPj48/pdLpg9BgIPaquTPn1YrGYNf4cAHoo3/drl5eXIkjzMQZqKs/zTjnnL2W9D7wsAgDNVC6XPyUSife2nQNAcr4/PDysbG1trfRdiegBNJAQ4nelUrnZ29tb+bsSAUDI6nQ6ZxKApIz8UA7BAEDIaT8Wi4VahtEDhDzthf0BAIDlAgAAAAIAEACA7NTcY2Amk4mUSqUGtk6Jbra3tzdJATBU2B8aQgmAAAAEACAAAAEAq6T6zTkAgJiur687AMBieZ73TeX1GN7GRUv9fv+H4zhZlRkAf45FRF+kVJqPEkBIruue7u7uflB9XTZRAVAONFS73T6Lx+Nvg7j2XwEGACbouxHl2VRVAAAAAElFTkSuQmCC'
    }

    // myWindow.addFrameButton(gatherTab);
    // TUTOR_TODO Chapter 4.4 - Implement the logic for each of these events - which buttons should show/hide in each scenario?
    // hint - maybe glue.windows.my().tabs.length would be useful somewhere?
    glue.windows.my().onWindowAttached((win) => {
        myWindow.removeFrameButton(gatherTab.buttonId);
        myWindow.addFrameButton(extractTab);
    });

    glue.windows.my().onAttached((win) => {
        myWindow.removeFrameButton(gatherTab.buttonId);
        myWindow.addFrameButton(extractTab);
    });

    glue.windows.my().onDetached((win) => {
        myWindow.removeFrameButton(extractTab.buttonId);
        myWindow.addFrameButton(gatherTab);
    });

    glue.windows.my().onWindowDetached((win) => {
        if (glue.windows.my().tabs.length < 2) {
            myWindow.removeFrameButton(extractTab.buttonId);
            myWindow.addFrameButton(gatherTab);
        }
    });

    // TUTOR_TODO 4.4  - Implement the frame button click events
    // - Which button was clicked?
    // - How are we going to remember the tabs we detached?
    // - glue.windows.findById() will be quite helpful here
    glue.windows.my().onFrameButtonClicked((buttonInfo, clickedWindow) => {
        const btnId = buttonInfo.buttonId;
        const parentWindowId = glue.windows.my().context.parentWindowId;
        const parentWindow = glue.windows.findById(parentWindowId);

        if (btnId === 'gatherTabs') {
            const existingTabList = glue.windows.list().find(win => win.tabs.length > 1);

            if (existingTabList) {
                existingTabList.attachTab(clickedWindow.id, 1);
                return;
            }

            clickedWindow.snap(parentWindow, 'right');

            // glue.windows.list()
            // .filter((window) => window.context.parentWindowId === clickedWindow.context.parentWindowId && window.mode === 'Tab')
            parentWindow.context.detachedTabs
                .forEach((tabId, index) => {
                    if (tabId !== clickedWindow.id) {
                        clickedWindow.attachTab(tabId, 1);
                    }
                });
        } else if (btnId === 'extractTabs') {
            const detachedTabs = glue.windows.my().tabs.map(tab => {
                tab.detachTab();
                return tab.id;
            });

            parentWindow.updateContext({
                detachedTabs,
            });
        }
    });

    // TUTOR_TODO Chapter 4.4 - What frame button should be displayed when the tab is created?
    myWindow.addFrameButton(extractTab);
};

const search = (event) => {
    event.preventDefault();
    var searchValue = document.getElementById('ticker').value;
    // TUTOR_TODO Chapter 6 - Use the created query's search function and pass in the searchValue;
    _query.search(searchValue);
};

const sendPortfolioAsEmailClicked = (event) => {
    event.preventDefault();

    const sendPortfolioAsEmail = (client, portfolio) => {

        const getEmailContent = (client, portfolio) => {

            const props = ['ric', 'description', 'bid', 'ask']

            const csv = props.join(", ") + "\n" +
                portfolio.map((row) => {
                    return props.map((prop, index) => {
                        let value = row[prop];

                        if (index === 1) {
                            value = '"' + value + '"'
                        }

                        return value;
                    }).join(", ")
                }).join("\n");

            const html = "<html>\n<body>\n<table>\n<tr><th>" + props.join("</th><th>") + "</th></tr>" +
                portfolio.map((row) => {
                    return "<tr><td>" + props.map((prop) => {
                        const value = row[prop];
                        return value;
                    }).join("</td><td>") + "</td></tr>"
                }).join("\n") + "\n</table>\n</body>\</html>\n";

            const fileName = 'client-' + client.pId + '-portfolio.csv';

            const file = {
                fileName: fileName,
                data: csv,
            };

            const newEmail = {
                to: 'john.doe@domain.com',
                subject: 'Hey John, look at ' + client.name + '\'s portfolio',
                bodyHtml: html,
                attachments: [file]
            };

            return newEmail;
        };

        const content = getEmailContent(client, portfolio);

        // TUTOR_TODO Chapter 8 - create a new email by passing the content object above.

        g4o.outlook.newEmail(content);
    }

    var portfolio = getCurrentPortfolio();
    console.log(partyObj);

    sendPortfolioAsEmail(partyObj, portfolio);
};

const sendPortfolioToExcelClicked = (event) => {
    event.preventDefault();

    const sendPortfolioToExcel = async (client, portfolio) => {
        const fields = ['ric', 'description', 'bid', 'ask'];

        const config = {
            columnConfig: [{
                fieldName: 'ric',
                header: 'RIC'
            }, {
                fieldName: 'description',
                header: 'Description'
            }, {
                fieldName: 'bid',
                header: 'Bid Price'
            }, {
                fieldName: 'ask',
                header: 'Ask Price'
            }],
            data: portfolio,
            options: {
                worksheet: client.name,
                workbook: 'ExportedPortfolios'
            }
        }

        const loadPortfolioFromExcel = (portfolio) => {

            unsubscribeSymbolPrices();

            removeChildNodes('portfolioTableData');
            const table = document.getElementById('portfolioTable').getElementsByTagName('tbody')[0];

            portfolio.forEach((item) => {
                item.RIC = item.ric;
                item.Description = item.description;
                addRow(table, item);
            })

            subscribeSymbolPrices();
        };

        // TUTOR_TODO Chapter 9 - create a new spreadsheet passing the config object, then subscribe to the new sheet's onChanged event and call loadPortfolioFromExcel with the received data
        // const excellApp = await glue.appManager.application('XlEdit');
        // excellApp.start();
        const excelSheet = await g4o.excel.openSheet(config);
        excelSheet.onChanged((data) => loadPortfolioFromExcel(data));
    };

    const portfolio = getCurrentPortfolio();

    sendPortfolioToExcel(partyObj, portfolio);
};
