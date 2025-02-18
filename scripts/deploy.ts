import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const TimeToken = await ethers.getContractFactory("TimeToken");
  const timeToken = await TimeToken.deploy();
  await timeToken.waitForDeployment();
  const timeTokenAddress = await timeToken.getAddress();

  console.log("TimeToken deployed to:", timeTokenAddress);

  const TimeStaking = await ethers.getContractFactory("TimeStaking");
  const timeStaking = await TimeStaking.deploy();
  await timeStaking.waitForDeployment();
  const timeStakingAddress = await timeStaking.getAddress();

  console.log("TimeStaking deployed to:", timeStakingAddress);

  // Initialize TimeToken
  await timeToken.initialize(
    deployer.address, // publicSaleAddress
    deployer.address, // operatorIncentivesAddress
    deployer.address, // communityTreasuryAddress
    deployer.address, // rewardsPoolAddress
    deployer.address, // developmentFundAddress
    deployer.address, // teamAddress
    deployer.address, // partnersAddress
    deployer.address, // liquidityAddress
    deployer.address  // insuranceAddress
  );

  // Initialize TimeStaking
  await timeStaking.initialize(
    timeTokenAddress,
    [deployer.address], // initial oracles
    1 // minOracleSignatures
  );

  console.log("Contracts initialized successfully");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
