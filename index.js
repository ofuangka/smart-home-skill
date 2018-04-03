const http = require('http');
const https = require('https');

const SMART_PREFIX = process.env.SMART_PREFIX;

const ErrorType = {
    BRIDGE_UNREACHABLE: 'BRIDGE_UNREACHABLE',
    INVALID_DIRECTIVE: 'INVALID_DIRECTIVE'
};

exports.handler = (request, context, callback) => {
    if (request.endpoint && request.endpoint.scope && request.endpoint.scope.token) {

    }
    if (request.directive && request.directive.header) {
        switch (request.directive.header.namespace) {
            case 'Alexa.Discovery':
                handleDiscoveryRequest(request, context, callback);
                break;
            case 'Alexa.PowerController':
                handleControllerRequest(request, context, callback);
                break;
            case 'Alexa.StepSpeakerController':
                handleControllerRequest(request, context, callback);
                break;
            case 'Alexa.PlaybackController':
                handleControllerRequest(request, context, callback);
                break;
            default: callback(new Error(`Unsupported namespace: ${request.directive.header.namespace}`));
        }
    }
};

function handleControllerRequest(request, context, callback) {
    const endpoint = request.directive.endpoint;
    const command = request.directive.header.name;
    if (endpoint.cookie && endpoint.cookie.hasOwnProperty && endpoint.cookie.hasOwnProperty(command)) {
        post(`${SMART_PREFIX}/devices/${endpoint.endpointId}/actions/${endpoint.cookie[command]}`)
            .then(upstreamResponse => {
                return getControllerResponse(endpoint);
            })
            .then(response => callback(null, response))
            .catch(err => callback(null, getErrorResponse(ErrorType.BRIDGE_UNREACHABLE, err, endpoint)));
    } else {
        callback(null, getErrorResponse(ErrorType.INVALID_DIRECTIVE, `command not available on endpoint: ${command}, ${endpoint.endpointId}`, endpoint));
    }
}

function handleDiscoveryRequest(request, context, callback) {
    get(`${SMART_PREFIX}/devices`)
        .then(JSON.parse)
        .then(convertDevices)
        .then(getDiscoverResponse)
        .then(response => callback(null, response))
        .catch(err => {
            console.error(err);
            callback(null, getDiscoverResponse([]));
        });
}

function convertDevices(devices) {
    return devices.map(device => {
        return {
            endpointId: device.id,
            manufacturerName: device.manufacturer,
            friendlyName: device.name,
            description: device.platform,
            displayCategories: getDisplayCategories(device),
            capabilities: getCapabilities(device),
            cookie: device.capabilities
        };
    });
}

function getDisplayCategories(device) {
    switch (device.platform) {
        case 'lirc':
            return ['TV'];
        case 'homeassistant':
            return [getHomeassistantDeviceCategory(device)];
        case 'roku':
            return ['TV'];
        default:
            return ['OTHER'];
    }
}

function getCapabilities(device) {
    switch (device.platform) {
        case 'lirc':
            return [
                getCapability('Alexa.PowerController'),
                getCapability('Alexa.StepSpeaker')
            ];
        case 'homeassistant':
            return [getCapability('Alexa.PowerController')];
        case 'rokuapp':
            return [getCapability('Alexa.PowerController')];
        case 'roku':
            return [getCapability('Alexa.PlaybackController')];
        default:
            return [];
    }
}

function getCapability(interface) {
    return {
        type: 'AlexaInterface',
        interface: interface,
        version: '3'
    };
}

function getHomeassistantDeviceCategory(device) {
    const deviceId = device.id;
    const domain = deviceId.substring(0, deviceId.indexOf('.')).toUpperCase();
    return ['LIGHT', 'SWITCH'].indexOf(domain) !== -1 ? domain : 'OTHER';
}

function getDiscoverResponse(endpoints) {
    return getResponse('Alexa.Discovery', 'DiscoverResponse', {
        endpoints: endpoints
    });
}

function getControllerResponse(endpoint) {
    return Object.assign({
        context: {
            properties: []
        }
    }, getResponse('Alexa', 'Response', {}, { endpoint: endpoint }));
}

function getErrorResponse(type, message, endpoint) {
    return getResponse('Alexa', 'ErrorResponse', {
        type: type,
        message: message
    }, { endpoint: endpoint });
}

function getResponse(namespace, name, payload, eventMerge) {
    return {
        event: Object.assign({}, eventMerge, {
            header: {
                namespace: namespace,
                name: name,
                payloadVersion: '3',
                messageId: Date.now()
            },
            payload: payload
        })
    };
}

function request(uri, options, rawPostData) {
    const uriComps = uri.replace('//', '').split(':');
    const postData = typeof rawPostData === 'object' ? JSON.stringify(rawPostData) : rawPostData;
    if (isUriCompsValid(uriComps)) {
        const [protocol, hostname, portAndPath] = uriComps;
        const port = portAndPath.substring(0, portAndPath.indexOf('/'));
        const path = portAndPath.substring(portAndPath.indexOf('/'));
        const mergedOptions = {
            protocol: `${protocol}:`,
            hostname: hostname,
            port: port,
            path: path,

            /* merge any provided headers */
            headers: Object.assign({},
                options ? options.headers : undefined,
                { 'Content-Type': 'application/json' }
            )
        };
        if (typeof postData === 'string') {

            /* make sure postData includes a Content-Length */
            mergedOptions.headers['Content-Length'] = Buffer.byteLength(postData);
        }
        return new Promise((resolve, reject) => {
            let handle = (mergedOptions.protocol === 'https:' ? https : http)
                .request(Object.assign({}, options, mergedOptions), response => {
                    let data = '';
                    response.on('data', chunk => {
                        data += chunk;
                    });
                    response.on('end', result => {
                        resolve(data);
                    });
                }).on('error', err => {
                    reject(err);
                });
            if (typeof postData === 'string') {
                handle.send(postData);
            }
            handle.end();
        });
    } else {
        return Promise.reject(new Error(`could not parse uri ${uri}`));
    }
}
function isUriCompsValid(uriComps) {
    return uriComps.length === 3 && /https?/.test(uriComps[0]) && /^[A-Z0-9\-_.]+$/i.test(uriComps[1]) && /^[0-9]{3,5}\/[A-Z0-9\-_~]*/i.test(uriComps[2]);
}

function get(uri, options) {
    return request(uri, options);
}

function post(uri, options, postData) {
    return request(Object.assign({}, options, { method: 'POST' }), postData);
}