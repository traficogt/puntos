import assert from 'node:assert/strict';
import {it} from 'node:test';
import * as model from '../src/second-visit-model.js';
it('reviews only whole bonus commitments within both caps and does not turn unknown cost into zero',()=>{
 assert.deepEqual(model.secondVisitCommitment({bonus_points:8,monthly_points_cap:101,monthly_offer_cap:20},null),{offers:12,points:96,cost:null});
 assert.deepEqual(model.secondVisitCommitment({bonus_points:8,monthly_points_cap:100,monthly_offer_cap:3},0),{offers:3,points:24,cost:0});
});
