import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@typechain/hardhat";
import '@openzeppelin/hardhat-upgrades';

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 50
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    hardhat: {
      chainId: 31337,
      mining: {
        auto: true,
        interval: 0,
        mempool: {
          order: "fifo"
        }
      },
      allowBlocksWithSameTimestamp: true,
      initialDate: "2025-02-17T08:37:52.000Z"
    },
    avalanche: {
      url: process.env.AVALANCHE_URL || "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  }
};

export default config;
