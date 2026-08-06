"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortNumberDesc = void 0;
const sortNumberDesc = (a, b) => {
    if (a < b) {
        return 1;
    }
    if (a > b) {
        return -1;
    }
    return 0;
};
exports.sortNumberDesc = sortNumberDesc;
