import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";

const enableGasReport = !!process.env.ENABLE_GAS_REPORT;
const enableProduction = process.env.COMPILE_MODE === "production";

const config: HardhatUserConfig = {
  solidity: "0.8.27",
  gasReporter: {
    enabled: enableGasReport,
    currency: "USD",
    outputFile: process.env.CI ? "gas-report.txt" : undefined,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
};

export default config;
