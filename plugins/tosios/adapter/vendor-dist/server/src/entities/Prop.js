"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Prop = void 0;
const _1 = require(".");
const schema_1 = require("@colyseus/schema");
class Prop extends _1.Circle {
    // Init
    constructor(propType, x, y, radius) {
        super(x, y, radius);
        this.type = propType;
        this.active = true;
    }
}
exports.Prop = Prop;
__decorate([
    (0, schema_1.type)('string')
], Prop.prototype, "type", void 0);
__decorate([
    (0, schema_1.type)('boolean')
], Prop.prototype, "active", void 0);
