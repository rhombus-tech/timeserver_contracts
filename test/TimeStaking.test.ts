/// <reference types="mocha" />
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { TimeStaking, TimeToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const REGION = "us-east-1";
const MIN_STAKE = ethers.parseEther("2000"); // 2000 TIME
const MIN_ORACLE_SIGNATURES = 2n;
const UNBONDING_PERIOD = 3n * 24n * 60n * 60n; // 3 days

describe("TimeStaking", function () {
    let timeToken: TimeToken;
    let timeStaking: TimeStaking;
    let owner: SignerWithAddress;
    let oracle1: SignerWithAddress;
    let oracle2: SignerWithAddress;
    let user1: SignerWithAddress;
    let testOperators: SignerWithAddress[];
    
    beforeEach(async function () {
        // Deploy contracts
        const TimeToken = await ethers.getContractFactory("TimeToken");
        const TimeStaking = await ethers.getContractFactory("TimeStaking");
        
        [owner, oracle1, oracle2, user1, ...testOperators] = await ethers.getSigners();

        // Deploy and initialize TimeToken
        timeToken = await upgrades.deployProxy(TimeToken, [
            owner.address,  // publicSaleAddress
            owner.address,  // operatorIncentivesAddress
            owner.address,  // communityTreasuryAddress
            owner.address,  // rewardsPoolAddress
            owner.address,  // developmentFundAddress
            owner.address,  // teamAddress
            owner.address,  // partnersAddress
            owner.address,  // liquidityAddress
            owner.address   // insuranceAddress
        ]) as unknown as TimeToken;
        
        timeStaking = await upgrades.deployProxy(TimeStaking, [
            await timeToken.getAddress(),
            MIN_STAKE,
            UNBONDING_PERIOD,
            MIN_ORACLE_SIGNATURES
        ]) as unknown as TimeStaking;

        // Transfer TIME tokens to test accounts
        for (let operator of testOperators) {
            await timeToken.transfer(operator.address, MIN_STAKE * 2n);
            await timeToken.connect(operator).approve(await timeStaking.getAddress(), MIN_STAKE * 2n);
        }

        // Add region
        await timeStaking.addRegion(REGION);
    });

    describe("Server Registration", function () {
        it("Should register a server correctly", async function () {
            const operator = testOperators[0];
            const serverID = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "string"],
                    [operator.address, REGION]
                )
            );
            
            await expect(timeStaking.connect(operator).registerServer(serverID, REGION))
                .to.emit(timeStaking, "ServerRegistered")
                .withArgs(serverID, operator.address, REGION, MIN_STAKE);

            const server = await timeStaking.servers(serverID);
            expect(server.owner).to.equal(operator.address);
            expect(server.stakedAmount).to.equal(MIN_STAKE);
            expect(server.isActive).to.be.true;
            expect(server.region).to.equal(REGION);
        });

        it("Should not register with insufficient stake", async function () {
            const operator = testOperators[0];
            const serverID = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "string"],
                    [operator.address, REGION]
                )
            );
            
            // Transfer away most tokens to leave insufficient stake
            const balance = await timeToken.balanceOf(operator.address);
            await timeToken.connect(operator).transfer(owner.address, balance - MIN_STAKE/2n);
            
            await expect(
                timeStaking.connect(operator).registerServer(serverID, REGION)
            ).to.be.revertedWith("Insufficient stake");
        });
    });

    describe("Oracle Slashing", function () {
        let serverID: string;
        
        beforeEach(async function () {
            // Register server first
            const operator = testOperators[0];
            serverID = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "string"],
                    [operator.address, REGION]
                )
            );
            await timeToken.connect(operator).approve(await timeStaking.getAddress(), MIN_STAKE);
            await timeStaking.connect(operator).registerServer(serverID, REGION);
        });
        
        it("Should slash server when reported by oracles", async function () {
            // Add oracles
            await timeStaking.addOracle(oracle1.address);
            await timeStaking.addOracle(oracle2.address);
            
            const slashAmount = ethers.parseEther("100");
            const reportHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256"],
                    [serverID, slashAmount]
                )
            );

            // Sign by oracles
            const signature1 = await oracle1.signMessage(ethers.getBytes(reportHash));
            const signature2 = await oracle2.signMessage(ethers.getBytes(reportHash));

            await expect(
                timeStaking.reportViolation(serverID, slashAmount, reportHash, [signature1, signature2])
            ).to.emit(timeStaking, "ServerSlashed")
             .withArgs(serverID, slashAmount);

            const server = await timeStaking.servers(serverID);
            expect(server.stakedAmount).to.equal(MIN_STAKE - slashAmount);
        });
    });

    describe("Governance", function () {
        it("Should create and execute proposal", async function () {
            const parameterName = "minStake";
            const proposedValue = ethers.parseEther("200");
            
            await timeStaking.createProposal(parameterName, proposedValue);
            await timeStaking.vote(0, true);
            
            // Get current block timestamp
            const currentBlock = await ethers.provider.getBlock("latest");
            const currentTime = currentBlock?.timestamp || 0;
            
            // Increase time by 8 days to be safe
            await ethers.provider.send("evm_setNextBlockTimestamp", [currentTime + 8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine", []);
            
            await timeStaking.executeProposal(0);
            
            expect(await timeStaking.minStake()).to.equal(proposedValue);
        });
    });

    describe("Region Management", function () {
        it("Should add and remove regions", async function () {
            const newRegion = "eu-west-1";
            
            await expect(timeStaking.addRegion(newRegion))
                .to.emit(timeStaking, "RegionAdded")
                .withArgs(newRegion);
            
            expect(await timeStaking.activeRegions(newRegion)).to.be.true;
            
            await expect(timeStaking.removeRegion(newRegion))
                .to.emit(timeStaking, "RegionRemoved")
                .withArgs(newRegion);
                
            expect(await timeStaking.activeRegions(newRegion)).to.be.false;
        });

        it("Should not add existing region", async function () {
            await expect(
                timeStaking.addRegion(REGION)
            ).to.be.revertedWith("Region exists");
        });

        it("Should not remove non-existent region", async function () {
            await expect(
                timeStaking.removeRegion("non-existent")
            ).to.be.revertedWith("Region not found");
        });

        it("Should not remove region with active servers", async function () {
            const operator = testOperators[0];
            const serverID = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "string"],
                    [operator.address, REGION]
                )
            );
            
            await timeStaking.connect(operator).registerServer(serverID, REGION);
            
            await expect(
                timeStaking.removeRegion(REGION)
            ).to.be.revertedWith("Region has active servers");
        });
    });

    describe("Oracle Management", function () {
        it("Should add and remove oracles", async function () {
            await expect(timeStaking.addOracle(oracle1.address))
                .to.emit(timeStaking, "OracleAdded")
                .withArgs(oracle1.address);
            
            expect(await timeStaking.oracles(oracle1.address)).to.be.true;
            
            await expect(timeStaking.removeOracle(oracle1.address))
                .to.emit(timeStaking, "OracleRemoved")
                .withArgs(oracle1.address);
                
            expect(await timeStaking.oracles(oracle1.address)).to.be.false;
        });

        it("Should not add existing oracle", async function () {
            await timeStaking.addOracle(oracle1.address);
            
            await expect(
                timeStaking.addOracle(oracle1.address)
            ).to.be.revertedWith("Already oracle");
        });

        it("Should not remove non-existent oracle", async function () {
            await expect(
                timeStaking.removeOracle(oracle1.address)
            ).to.be.revertedWith("Not oracle");
        });
    });

    describe("Emergency Functions", function () {
        let serverID: string;
        
        beforeEach(async function () {
            const operator = testOperators[0];
            serverID = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "string"],
                    [operator.address, REGION]
                )
            );
            await timeToken.connect(operator).approve(await timeStaking.getAddress(), MIN_STAKE);
            await timeStaking.connect(operator).registerServer(serverID, REGION);
        });

        it("Should pause and unpause", async function () {
            await timeStaking.emergencyPause();
            expect(await timeStaking.paused()).to.be.true;
            
            await timeStaking.emergencyUnpause();
            expect(await timeStaking.paused()).to.be.false;
        });

        it("Should execute emergency recovery", async function () {
            const reason = "Security breach";
            
            await expect(timeStaking.emergencyRecovery(serverID, reason))
                .to.emit(timeStaking, "EmergencyRecoveryExecuted")
                .withArgs(serverID, reason);
            
            const server = await timeStaking.servers(serverID);
            expect(server.isActive).to.be.false;
        });

        it("Should not allow non-owner to pause", async function () {
            await expect(
                timeStaking.connect(testOperators[0]).emergencyPause()
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should not allow non-owner to execute recovery", async function () {
            await expect(
                timeStaking.connect(testOperators[0]).emergencyRecovery(serverID, "reason")
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("View Functions", function () {
        let serverID: string;
        
        beforeEach(async function () {
            const operator = testOperators[0];
            serverID = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "string"],
                    [operator.address, REGION]
                )
            );
            await timeToken.connect(operator).approve(await timeStaking.getAddress(), MIN_STAKE);
            await timeStaking.connect(operator).registerServer(serverID, REGION);
        });

        it("Should get server status", async function () {
            const [isActive, stakedAmount, unbondingTime] = await timeStaking.getServerStatus(serverID);
            
            expect(isActive).to.be.true;
            expect(stakedAmount).to.equal(MIN_STAKE);
            expect(unbondingTime).to.equal(0);
        });

        it("Should get region stats", async function () {
            const [serverCount, activeServers, regionStake] = await timeStaking.getRegionStats(REGION);
            
            expect(serverCount).to.equal(1);
            expect(activeServers).to.equal(1);
            expect(regionStake).to.equal(MIN_STAKE);
        });
    });
});
