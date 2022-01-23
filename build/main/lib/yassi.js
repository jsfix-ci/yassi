"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._republish = exports._communicate = exports._registerEndpoint = exports._facade = exports._registerMiddleware = exports._get = exports.overrideSelectPropertyDefinition = exports.overridePropertyDefinition = exports._yassit = exports.YassiPropertyDescriptor = void 0;
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const store_1 = require("./store");
const beforeYassitMiddleware = [];
const afterYassitMiddleware = [];
const beforeSelectingMiddleware = [];
const afterSelectingMiddleware = [];
function DEFAULT_LOGGER_MIDDLEWARE(prototype, key, value) {
    if (prototype) {
        if (prototype.constructor && prototype.constructor.name) {
            console.log(`${prototype.constructor.name}.${key}=${JSON.stringify(value)}`);
        }
        else {
            console.log(`${prototype}.${key}=${JSON.stringify(value)}`);
        }
    }
}
// tslint:disable-next-line:variable-name
const _facadeOwner = {};
class YassiPropertyDescriptor {
    constructor(name, fullAccess = false) {
        this.name = name;
        this.fullAccess = fullAccess;
    }
    static validateYassiPropertyName(yassiPropName) {
        if (!yassiPropName || yassiPropName.length <= 0 || !RegExp('^[A-Za-z_][A-Za-z_$0-9^.].*').test(yassiPropName)) {
            throw new Error('You must provide valid yassiPropertyName');
        }
    }
}
exports.YassiPropertyDescriptor = YassiPropertyDescriptor;
function _yassit(name, owner, ownerProp) {
    if (owner && ownerProp) {
        // When the call to yassit was made directly without annotation
        overridePropertyDefinition(owner, ownerProp, new YassiPropertyDescriptor(name));
        return null;
    }
    // TODO: provide property descriptor from strategy class (i.e. allow different type of property storing
    return function (target, key) {
        overridePropertyDefinition(target, key, new YassiPropertyDescriptor(name));
    };
}
exports._yassit = _yassit;
/**
 * To make sure the property definition is on the instance and not on the class you need to define the property
 *  to override itself with another property definition.
 *  This way when the class is loaded the property definition is called and set a new setter definition
 *  Now each time an instance is called the setter is called and set a new setter and getter definition
 * Thanks to Romke Van Der Meulen - https://romkevandermeulen.nl/2018/01/24/typescript-property-decorators.html
 */
function overridePropertyDefinition(prototype, key, yassiDescriptor) {
    try {
        store_1.yassiStore.ensureUniqueuness(yassiDescriptor.name);
    }
    catch (e) {
        if (e.type === 'duplicate') {
            console.error(`Ignoring: ${e.message}`);
            return;
        }
        throw e;
    }
    store_1.yassiStore.set(yassiDescriptor.name, new store_1.StoreElement(store_1.ElementStatus.ACTIVE, prototype));
    /**
     * prototype - The constructor of the class that declared yassit on a property
     * key - the property name that yassit was attached too
     */
    Object.defineProperty(prototype, key, {
        set(firstValue) {
            // First set called on instantiation of the class
            activateElementIfNeeded(yassiDescriptor);
            Object.defineProperty(this, key, {
                // this - the instance of a 'prototype' class
                get() {
                    const elem = store_1.yassiStore.get(yassiDescriptor.name);
                    return elem ? elem.value : undefined;
                },
                set(value) {
                    // Here we override the above set
                    executeBeforeYassitMiddleware(prototype, key, value);
                    const elem = store_1.yassiStore.get(yassiDescriptor.name);
                    setElementValueHandler(elem, value, prototype, key);
                    store_1.yassiStore.set(yassiDescriptor.name, elem);
                    if (!Array.isArray(elem.value)) {
                        elem.observer.next(elem.value);
                    }
                    executeAfterYassitMiddleware(prototype, key, elem.value);
                },
                enumerable: true,
            });
            const element = store_1.yassiStore.get(yassiDescriptor.name);
            element.setOwner(this);
            this[key] = firstValue;
        },
        enumerable: true,
        configurable: true,
    });
}
exports.overridePropertyDefinition = overridePropertyDefinition;
function setElementValueHandler(element, value, prototype, key) {
    if (Array.isArray(value)) {
        // a proxy for our array
        element.value = new Proxy(value, {
            // apply(target: any, thisArg, argumentList?: any) {
            //   executeBeforeYassitMiddleware(prototype, key, value);
            //   const result = thisArg[target].apply(this, argumentList);
            //   element.observer.next(element.value);
            //   executeAfterYassitMiddleware(prototype, key, element.value);
            //   return result;
            // },
            // @ts-ignore
            deleteProperty(target, property) {
                return true;
            },
            // @ts-ignore
            set(target, property, val, receiver) {
                if (!Number.isInteger(parseInt(property, 10))) {
                    // Array properties that are not the items such as length
                    target[property] = val;
                    return true;
                }
                executeBeforeYassitMiddleware(prototype, key, element.value);
                target[property] = val;
                element.observer.next(getSafeValue(element.value));
                executeAfterYassitMiddleware(prototype, key, element.value);
                return true;
            },
        });
        // The reference was change so need to fire the event
        // TODO: Do we need a revokeable Proxy and revoke it here???
        element.observer.next(element.value);
    }
    else if (typeof value === 'object') {
        element.value = new Proxy(value, {
            // @ts-ignore
            deleteProperty(target, property) {
                return true;
            },
            // @ts-ignore
            set(target, property, val, receiver) {
                if (!target[property] || target.hasOwnProperty(property)) {
                    executeBeforeYassitMiddleware(prototype, key, value);
                    target[property] = val;
                    element.observer.next(getSafeValue(element.value));
                    executeAfterYassitMiddleware(prototype, key, element.value);
                }
                else {
                    target[property] = val;
                }
                return true;
            },
        });
    }
    else {
        element.value = value;
    }
}
function getSafeValue(value) {
    if (value) {
        if (typeof value === 'object') {
            // TODO: Change this implementation with exceptional Proxy
            if (Array.isArray(value)) {
                return [...value];
            }
            else {
                return Object.assign({}, value);
            }
        }
    }
    return value;
}
function activateElementIfNeeded(yassiDescriptor) {
    const element = store_1.yassiStore.get(yassiDescriptor.name);
    if (!element) {
        throw new Error(`Element ${yassiDescriptor.name} does not exist... Odd`);
    }
    if (element.status === store_1.ElementStatus.PENDING) {
        element.status = store_1.ElementStatus.ACTIVE;
        store_1.yassiStore.set(yassiDescriptor.name, element);
    }
}
function overrideSelectPropertyDefinition(prototype, key, yassiDescriptor, obsrv = false) {
    Object.defineProperty(prototype, key, {
        get() {
            executeBeforeSelectMiddleware(prototype, key);
            // One may observe a property that was not yassit yet. In this case we like to create a pending entry in the store
            const element = store_1.yassiStore.getOrCreate(yassiDescriptor.name, store_1.ElementStatus.PENDING);
            const result = obsrv ? element.observer.asObservable() : element.value;
            executeAfterSelectMiddleware(prototype, key, element ? element.value : null);
            return result;
        },
        // We don't create setter since we want selected properties to behave like readonly properties
    });
}
exports.overrideSelectPropertyDefinition = overrideSelectPropertyDefinition;
function _get(yassiDescriptor) {
    const element = store_1.yassiStore.get(yassiDescriptor.name);
    return element ? getSafeValue(element.value) : undefined;
}
exports._get = _get;
function _registerMiddleware(action, position, fn = null) {
    fn = fn || DEFAULT_LOGGER_MIDDLEWARE;
    let arrayToSearch;
    switch (action) {
        case 'yassit':
            arrayToSearch = position === 'after' ? afterYassitMiddleware : beforeYassitMiddleware;
            break;
        case 'observe':
        case 'select':
            arrayToSearch = position === 'after' ? afterSelectingMiddleware : beforeSelectingMiddleware;
            break;
        default:
            return;
    }
    for (const item of arrayToSearch) {
        // prevent duplication
        if (item === fn) {
            return;
        }
    }
    arrayToSearch.push(fn);
}
exports._registerMiddleware = _registerMiddleware;
function _facade(yassiDescriptor, sourceElementDescriptors, fn) {
    if (_facadeOwner[yassiDescriptor.name] === undefined) {
        _facadeOwner[yassiDescriptor.name] = null;
    }
    _yassit(yassiDescriptor.name, _facadeOwner, yassiDescriptor.name);
    const yassiElements$ = [];
    for (const descriptor of sourceElementDescriptors) {
        yassiElements$.push(store_1.yassiStore.getOrCreate(descriptor.name, store_1.ElementStatus.PENDING).observer);
    }
    (0, rxjs_1.combineLatest)(yassiElements$)
        .pipe((0, operators_1.map)(fn), (0, operators_1.filter)((result) => {
        return result != null && !result.breakFacadeChain;
    }), (0, operators_1.map)((result) => {
        // the existence of breakFacadeChain indicates that we need to return the payload only instead of the entire results
        return result.breakFacadeChain != null ? result.payload : result;
    }), (0, operators_1.catchError)((err) => {
        console.log(err);
        return err;
    }))
        .subscribe((facadeResults) => {
        store_1.yassiStore.get(yassiDescriptor.name).observer.next(facadeResults);
    });
}
exports._facade = _facade;
function _registerEndpoint(target, key) {
    const elements = store_1.yassiStore.findElementsByOwner(target);
    for (const element of elements) {
        if (element && !element.endpoints.has(key)) {
            element.endpoints.set(key, target[key]);
        }
    }
}
exports._registerEndpoint = _registerEndpoint;
function _communicate(yassiPropName, apiFunctionName, functionParams) {
    const element = store_1.yassiStore.get(yassiPropName);
    if (!element) {
        console.warn(`Yassi - Cannot call owner of ${yassiPropName}, unknown property`);
        return;
    }
    const fn = element.endpoints.get(apiFunctionName);
    if (!fn || typeof fn !== 'function') {
        console.warn(`Yassi - ${apiFunctionName} is not a known endpoint of ${yassiPropName} owner object`);
        return;
    }
    // TODO: Can we catch errors of wrong params executions and do something here - what???
    fn.call(element.owner, ...functionParams);
}
exports._communicate = _communicate;
function _republish(yassiPropName) {
    const element = store_1.yassiStore.get(yassiPropName);
    if (!element) {
        console.warn(`Yassi - Cannot call owner of ${yassiPropName}, unknown property`);
        return;
    }
    element.observer.next(element.value);
}
exports._republish = _republish;
// @ts-ignore
function executeBeforeYassitMiddleware(prototype, key, value) {
    for (const item of beforeYassitMiddleware) {
        item(prototype, key, value);
    }
}
// @ts-ignore
function executeAfterYassitMiddleware(prototype, key, value) {
    for (const item of afterYassitMiddleware) {
        item(prototype, key, value);
    }
}
// @ts-ignore
function executeBeforeSelectMiddleware(prototype, key) {
    for (const item of beforeSelectingMiddleware) {
        item(prototype, key);
    }
}
// @ts-ignore
function executeAfterSelectMiddleware(prototype, key, value) {
    for (const item of afterSelectingMiddleware) {
        item(prototype, key, value);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoieWFzc2kuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbGliL3lhc3NpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLCtCQUFpRDtBQUNqRCw4Q0FBeUQ7QUFFekQsbUNBQWtFO0FBRWxFLE1BQU0sc0JBQXNCLEdBQUcsRUFBRSxDQUFDO0FBQ2xDLE1BQU0scUJBQXFCLEdBQUcsRUFBRSxDQUFDO0FBQ2pDLE1BQU0seUJBQXlCLEdBQUcsRUFBRSxDQUFDO0FBQ3JDLE1BQU0sd0JBQXdCLEdBQUcsRUFBRSxDQUFDO0FBRXBDLFNBQVMseUJBQXlCLENBQUMsU0FBYyxFQUFFLEdBQVcsRUFBRSxLQUFVO0lBQ3hFLElBQUksU0FBUyxFQUFFO1FBQ2IsSUFBSSxTQUFTLENBQUMsV0FBVyxJQUFJLFNBQVMsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFO1lBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxTQUFTLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSxHQUFHLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7U0FDOUU7YUFBTTtZQUNMLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxTQUFTLElBQUksR0FBRyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1NBQzdEO0tBQ0Y7QUFDSCxDQUFDO0FBRUQseUNBQXlDO0FBQ3pDLE1BQU0sWUFBWSxHQUFHLEVBQUUsQ0FBQztBQUV4QixNQUFhLHVCQUF1QjtJQVlsQyxZQUFZLElBQUksRUFBRSxVQUFVLEdBQUcsS0FBSztRQUNsQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztRQUNqQixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQztJQUMvQixDQUFDO0lBZEQsTUFBTSxDQUFDLHlCQUF5QixDQUFDLGFBQXFCO1FBQ3BELElBQUksQ0FBQyxhQUFhLElBQUksYUFBYSxD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