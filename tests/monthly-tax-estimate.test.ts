import test from "node:test";
import assert from "node:assert/strict";
import {monthlyTaxEstimate} from "../src/lib/monthly-tax-estimate";
test("monthly tax estimate follows published BIR bracket base amounts",()=>{for(const [income,expected] of [[0,0],[20833,0],[33333,1875],[66667,8541.8],[166667,33541.8],[666667,183541.8]])assert.equal(monthlyTaxEstimate(income).tax,expected)});
test("monthly tax estimate computes representative marginal amounts",()=>{for(const [income,expected] of [[30000,1375.05],[50000,5208.4],[100000,16875.05],[1000000,300208.35]])assert.equal(monthlyTaxEstimate(income).tax,expected)});
test("monthly tax estimate rejects invalid or unbounded amounts",()=>{for(const income of [-1,NaN,Infinity,1000000001])assert.throws(()=>monthlyTaxEstimate(income),RangeError)});
