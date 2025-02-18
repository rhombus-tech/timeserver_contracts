import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { TimeToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse, EventLog } from "ethers";

describe("TimeToken", function () {
    let timeToken: TimeToken;
    let owner: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let addresses: HardhatEthersSigner[];
    
    // Constants for distribution (in basis points, 10000 = 100%)
    const PUBLIC_SALE = 1500;    // 15%
    const OPERATOR_INCENTIVES = 1500;  // 15%
    const COMMUNITY_TREASURY = 1000;   // 10%
    const REWARDS_POOL = 2000;    // 20%
    const DEVELOPMENT_FUND = 1000;  // 10%
    const TEAM = 1000;    // 10%
    const PARTNERS = 1000;  // 10%
    const LIQUIDITY = 500;   // 5%
    const INSURANCE = 500;   // 5%
    
    beforeEach(async function () {
        [owner, user1, user2, ...addresses] = await ethers.getSigners();
        
        const TimeTokenFactory = await ethers.getContractFactory("TimeToken");
        timeToken = await upgrades.deployProxy(TimeTokenFactory, [
            addresses[0].address, // publicSale
            addresses[1].address, // operatorIncentives
            addresses[2].address, // communityTreasury
            addresses[3].address, // rewardsPool
            addresses[4].address, // developmentFund
            addresses[5].address, // team
            addresses[6].address, // partners
            addresses[7].address, // liquidity
            addresses[8].address  // insurance
        ]) as unknown as TimeToken;
        await timeToken.waitForDeployment();
    });
    
    describe("Initialization", function () {
        it("Should initialize with correct distribution", async function () {
            const totalSupply = await timeToken.TOTAL_SUPPLY();
            expect(totalSupply).to.equal(ethers.parseEther("100000000")); // 100M tokens

            // Check name and symbol
            expect(await timeToken.name()).to.equal("Time Network Token");
            expect(await timeToken.symbol()).to.equal("TIME");

            // Check bucket allocations
            const publicSaleBucket = await timeToken.buckets(ethers.encodeBytes32String("publicSale"));
            const operatorIncentivesBucket = await timeToken.buckets(ethers.encodeBytes32String("operatorIncentives"));
            const communityTreasuryBucket = await timeToken.buckets(ethers.encodeBytes32String("communityTreasury"));

            // Verify bucket amounts (15%, 15%, 10% respectively)
            expect(publicSaleBucket.amount).to.equal(totalSupply * 1500n / 10000n); // 15%
            expect(operatorIncentivesBucket.amount).to.equal(totalSupply * 1500n / 10000n); // 15%
            expect(communityTreasuryBucket.amount).to.equal(totalSupply * 1000n / 10000n); // 10%

            // Verify recipients
            expect(publicSaleBucket.recipient).to.equal(addresses[0].address);
            expect(operatorIncentivesBucket.recipient).to.equal(addresses[1].address);
            expect(communityTreasuryBucket.recipient).to.equal(addresses[2].address);
        });

        it("Should not initialize twice", async function () {
            await expect(
                timeToken.initialize(
                    addresses[0].address,
                    addresses[1].address,
                    addresses[2].address,
                    addresses[3].address,
                    addresses[4].address,
                    addresses[5].address,
                    addresses[6].address,
                    addresses[7].address,
                    addresses[8].address
                )
            ).to.be.revertedWith("Initializable: contract is already initialized");
        });
    });

    describe("Token Distribution", function () {
        describe("Vesting Schedule", function () {
            it("Should correctly handle partial vesting periods", async function () {
                const bucketId = ethers.encodeBytes32String("publicSale");
                const bucket = await timeToken.buckets(bucketId);
                
                // Test 25% through vesting
                await ethers.provider.send("evm_increaseTime", [45 * 24 * 60 * 60]); // 45 days (25% of 180 days)
                await ethers.provider.send("evm_mine", []);
                await timeToken.connect(addresses[0]).release(bucketId);
                let balance = await timeToken.balanceOf(addresses[0].address);
                expect(balance).to.be.closeTo(bucket.amount * 25n / 100n, ethers.parseEther("1")); // 1 token tolerance
                
                // Test 50% through vesting
                await ethers.provider.send("evm_increaseTime", [45 * 24 * 60 * 60]); // Another 45 days
                await ethers.provider.send("evm_mine", []);
                await timeToken.connect(addresses[0]).release(bucketId);
                balance = await timeToken.balanceOf(addresses[0].address);
                expect(balance).to.be.closeTo(bucket.amount * 50n / 100n, ethers.parseEther("1"));
                
                // Test 75% through vesting
                await ethers.provider.send("evm_increaseTime", [45 * 24 * 60 * 60]); // Another 45 days
                await ethers.provider.send("evm_mine", []);
                await timeToken.connect(addresses[0]).release(bucketId);
                balance = await timeToken.balanceOf(addresses[0].address);
                expect(balance).to.be.closeTo(bucket.amount * 75n / 100n, ethers.parseEther("1"));
            });

            it("Should handle exact cliff period timing", async function () {
                const bucketId = ethers.encodeBytes32String("communityTreasury");
                
                // Test just before cliff
                await ethers.provider.send("evm_increaseTime", [180 * 24 * 60 * 60 - 1]); // 180 days - 1 second
                await ethers.provider.send("evm_mine", []);
                await expect(
                    timeToken.connect(addresses[2]).release(bucketId)
                ).to.be.revertedWith("Cliff not reached");
                
                // Test exactly at cliff
                await ethers.provider.send("evm_increaseTime", [1]); // +1 second
                await ethers.provider.send("evm_mine", []);
                await timeToken.connect(addresses[2]).release(bucketId);
                const balance = await timeToken.balanceOf(addresses[2].address);
                expect(balance).to.be.gt(0);
            });

            it("Should handle rounding with odd durations", async function () {
                // Use operatorIncentives bucket which has a 3-year vesting period
                const bucketId = ethers.encodeBytes32String("operatorIncentives");
                const bucket = await timeToken.buckets(bucketId);
                
                // Test at various odd intervals (using 3 year duration)
                const oddIntervals = [
                    (3 * 365 * 24 * 60 * 60) / 3,      // 1 year
                    (3 * 365 * 24 * 60 * 60) / 2,      // 1.5 years
                    (3 * 365 * 24 * 60 * 60) * 2 / 3   // 2 years
                ];
                
                let totalTimeElapsed = 0;
                let previousBalance = 0n;
                
                for (const interval of oddIntervals) {
                    // Move time forward by the difference
                    const timeToMove = Math.floor(interval) - totalTimeElapsed;
                    await ethers.provider.send("evm_increaseTime", [timeToMove]);
                    await ethers.provider.send("evm_mine", []);
                    
                    await timeToken.connect(addresses[1]).release(bucketId);
                    const balance = await timeToken.balanceOf(addresses[1].address);
                    const expectedAmount = (bucket.amount * BigInt(Math.floor(interval))) / BigInt(3 * 365 * 24 * 60 * 60);
                    
                    // Check the difference from the last release
                    const releasedThisInterval = balance - previousBalance;
                    const expectedThisInterval = expectedAmount - previousBalance;
                    expect(releasedThisInterval).to.be.closeTo(expectedThisInterval, ethers.parseEther("0.1")); // 0.1 token tolerance
                    
                    previousBalance = balance;
                    totalTimeElapsed = Math.floor(interval);
                }
            });
        });

        describe("Multiple Releases", function () {
            it("Should handle multiple releases from same bucket correctly", async function () {
                const bucketId = ethers.encodeBytes32String("publicSale");
                const bucket = await timeToken.buckets(bucketId);
                
                // First release at 30%
                await ethers.provider.send("evm_increaseTime", [54 * 24 * 60 * 60]); // 54 days (30% of 180)
                await ethers.provider.send("evm_mine", []);
                await timeToken.connect(addresses[0]).release(bucketId);
                let balance = await timeToken.balanceOf(addresses[0].address);
                let expected = (bucket.amount * 30n) / 100n;
                expect(balance).to.be.closeTo(expected, ethers.parseEther("1"));
                
                // Second release at 60%
                await ethers.provider.send("evm_increaseTime", [54 * 24 * 60 * 60]); // Another 54 days
                await ethers.provider.send("evm_mine", []);
                await timeToken.connect(addresses[0]).release(bucketId);
                balance = await timeToken.balanceOf(addresses[0].address);
                expected = (bucket.amount * 60n) / 100n;
                expect(balance).to.be.closeTo(expected, ethers.parseEther("1"));
            });

            it("Should emit TokensReleased event with correct parameters", async function () {
                const bucketId = ethers.encodeBytes32String("publicSale");
                await ethers.provider.send("evm_increaseTime", [90 * 24 * 60 * 60]); // 90 days
                await ethers.provider.send("evm_mine", []);
                
                const tx = await timeToken.connect(addresses[0]).release(bucketId);
                const receipt = await tx.wait();
                if (!receipt) throw new Error("Transaction failed");
                
                const event = receipt.logs.find(
                    (log): log is EventLog => 
                        log instanceof EventLog && 
                        log.eventName === "TokensReleased"
                );
                
                expect(event).to.not.be.undefined;
                expect(event?.args?.bucketId).to.equal(bucketId);
                expect(event?.args?.recipient).to.equal(addresses[0].address);
                expect(event?.args?.amount).to.be.gt(0);
            });
        });

        it("Should release tokens according to vesting schedule", async function () {
            const bucketId = ethers.encodeBytes32String("publicSale");
            const bucket = await timeToken.buckets(bucketId);
            
            // Move time forward by 90 days (half of the 180-day vesting period)
            await ethers.provider.send("evm_increaseTime", [90 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine", []);
            
            await timeToken.connect(addresses[0]).release(bucketId);
            
            // Should have released approximately 50% of tokens
            const balance = await timeToken.balanceOf(addresses[0].address);
            const expectedAmount = bucket.amount / 2n;
            const tolerance = ethers.parseEther("1"); // 1 token tolerance
            
            expect(balance).to.be.gt(expectedAmount - tolerance);
            expect(balance).to.be.lt(expectedAmount + tolerance);

            // Get bucket info and verify
            const bucketInfo = await timeToken.getBucketInfo(bucketId);
            expect(bucketInfo.amount).to.equal(bucket.amount);
            expect(bucketInfo.released).to.equal(balance);
            expect(bucketInfo.initialized).to.be.true;
            expect(bucketInfo.recipient).to.equal(addresses[0].address);
        });

        it("Should not release tokens before cliff period", async function () {
            const bucketId = ethers.encodeBytes32String("communityTreasury"); // Has 180 day cliff
            
            // Try to release before cliff period
            await expect(
                timeToken.connect(addresses[2]).release(bucketId)
            ).to.be.revertedWith("Cliff not reached");
            
            // Verify through getBucketInfo
            const bucketInfo = await timeToken.getBucketInfo(bucketId);
            expect(bucketInfo.released).to.equal(0);
            
            // Move time to just before cliff
            await ethers.provider.send("evm_increaseTime", [179 * 24 * 60 * 60]); // 179 days
            await ethers.provider.send("evm_mine", []);
            
            // Should still not be able to release
            await expect(
                timeToken.connect(addresses[2]).release(bucketId)
            ).to.be.revertedWith("Cliff not reached");
            
            // Move time past cliff
            await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]); // 2 more days
            await ethers.provider.send("evm_mine", []);
            
            // Now should be able to release
            await timeToken.connect(addresses[2]).release(bucketId);
            expect(await timeToken.balanceOf(addresses[2].address)).to.be.gt(0);
        });

        it("Should not release from uninitialized bucket", async function () {
            const bucketId = ethers.encodeBytes32String("nonexistent");
            await expect(
                timeToken.connect(user1).release(bucketId)
            ).to.be.revertedWith("Bucket not initialized");
        });

        it("Should release all tokens after vesting period", async function () {
            const bucketId = ethers.encodeBytes32String("publicSale");
            const bucket = await timeToken.buckets(bucketId);

            // Move time past the vesting period (180 days for public sale)
            await ethers.provider.send("evm_increaseTime", [180 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine", []);

            await timeToken.connect(addresses[0]).release(bucketId);
            expect(await timeToken.balanceOf(addresses[0].address)).to.equal(bucket.amount);
        });
    });

    describe("Token Transfers", function () {
        beforeEach(async function () {
            // Move time forward and release tokens for testing
            await ethers.provider.send("evm_increaseTime", [180 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine", []);
            
            const bucketId = ethers.encodeBytes32String("publicSale");
            await timeToken.connect(addresses[0]).release(bucketId);
        });

        it("Should transfer tokens between accounts", async function () {
            const amount = ethers.parseEther("1000");
            await timeToken.connect(addresses[0]).transfer(user1.address, amount);
            expect(await timeToken.balanceOf(user1.address)).to.equal(amount);

            await timeToken.connect(user1).transfer(user2.address, amount);
            expect(await timeToken.balanceOf(user2.address)).to.equal(amount);
            expect(await timeToken.balanceOf(user1.address)).to.equal(0);
        });

        it("Should handle allowances correctly", async function () {
            const amount = ethers.parseEther("1000");
            await timeToken.connect(addresses[0]).transfer(user1.address, amount);

            await timeToken.connect(user1).approve(user2.address, amount);
            expect(await timeToken.allowance(user1.address, user2.address)).to.equal(amount);

            await timeToken.connect(user2).transferFrom(user1.address, user2.address, amount);
            expect(await timeToken.balanceOf(user2.address)).to.equal(amount);
            expect(await timeToken.balanceOf(user1.address)).to.equal(0);
            expect(await timeToken.allowance(user1.address, user2.address)).to.equal(0);
        });
    });

    describe("Upgradeability", function () {
        it("Should only allow owner to upgrade", async function () {
            const TimeTokenFactory = await ethers.getContractFactory("TimeToken");
            await expect(
                upgrades.upgradeProxy(await timeToken.getAddress(), TimeTokenFactory.connect(user1))
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should preserve state after upgrade", async function () {
            // Release some tokens first to create state
            const bucketId = ethers.encodeBytes32String("publicSale");
            await ethers.provider.send("evm_increaseTime", [90 * 24 * 60 * 60]); // 90 days
            await ethers.provider.send("evm_mine", []);
            await timeToken.connect(addresses[0]).release(bucketId);
            
            // Record state before upgrade
            const bucketBefore = await timeToken.buckets(bucketId);
            const balanceBefore = await timeToken.balanceOf(addresses[0].address);
            
            // Perform upgrade
            const TimeTokenFactory = await ethers.getContractFactory("TimeToken");
            const upgradedToken = await upgrades.upgradeProxy(
                await timeToken.getAddress(),
                TimeTokenFactory
            ) as unknown as typeof timeToken;
            
            // Verify state is preserved
            const bucketAfter = await upgradedToken.buckets(bucketId);
            const balanceAfter = await upgradedToken.balanceOf(addresses[0].address);
            
            expect(bucketAfter.amount).to.equal(bucketBefore.amount);
            expect(bucketAfter.released).to.equal(bucketBefore.released);
            expect(bucketAfter.startTime).to.equal(bucketBefore.startTime);
            expect(bucketAfter.duration).to.equal(bucketBefore.duration);
            expect(bucketAfter.cliff).to.equal(bucketBefore.cliff);
            expect(bucketAfter.recipient).to.equal(bucketBefore.recipient);
            expect(bucketAfter.initialized).to.equal(bucketBefore.initialized);
            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("Should continue functioning after upgrade", async function () {
            // Perform upgrade
            const TimeTokenFactory = await ethers.getContractFactory("TimeToken");
            const upgradedToken = await upgrades.upgradeProxy(
                await timeToken.getAddress(),
                TimeTokenFactory
            ) as unknown as typeof timeToken;
            
            // Test core functionality post-upgrade
            const bucketId = ethers.encodeBytes32String("publicSale");
            await ethers.provider.send("evm_increaseTime", [45 * 24 * 60 * 60]); // 45 days
            await ethers.provider.send("evm_mine", []);
            
            // Should be able to release tokens
            await upgradedToken.connect(addresses[0]).release(bucketId);
            const balance = await upgradedToken.balanceOf(addresses[0].address);
            expect(balance).to.be.gt(0);
            
            // Should be able to transfer tokens
            const transferAmount = balance / 2n;
            await upgradedToken.connect(addresses[0]).transfer(user1.address, transferAmount);
            expect(await upgradedToken.balanceOf(user1.address)).to.equal(transferAmount);
        });
    });

    describe("Initialization Validation", function () {
        it("Should have total bucket percentages equal to 100%", async function () {
            const totalBasisPoints = 
                PUBLIC_SALE +
                OPERATOR_INCENTIVES +
                COMMUNITY_TREASURY +
                REWARDS_POOL +
                DEVELOPMENT_FUND +
                TEAM +
                PARTNERS +
                LIQUIDITY +
                INSURANCE;
            
            expect(totalBasisPoints).to.equal(10000); // 100% in basis points
        });

        it("Should initialize all buckets with correct vesting parameters", async function () {
            // Check public sale bucket
            const publicSaleBucket = await timeToken.buckets(ethers.encodeBytes32String("publicSale"));
            expect(publicSaleBucket.duration).to.equal(180 * 24 * 60 * 60); // 180 days
            expect(publicSaleBucket.cliff).to.equal(0);
            
            // Check team bucket
            const teamBucket = await timeToken.buckets(ethers.encodeBytes32String("team"));
            expect(teamBucket.duration).to.equal(2 * 365 * 24 * 60 * 60); // 2 years
            expect(teamBucket.cliff).to.equal(365 * 24 * 60 * 60); // 1 year
            
            // Check partners bucket
            const partnersBucket = await timeToken.buckets(ethers.encodeBytes32String("partners"));
            expect(partnersBucket.duration).to.equal(365 * 24 * 60 * 60); // 1 year
            expect(partnersBucket.cliff).to.equal(180 * 24 * 60 * 60); // 180 days
        });

        it("Should mint liquidity and insurance tokens immediately", async function () {
            const liquidityBalance = await timeToken.balanceOf(addresses[7].address);
            const insuranceBalance = await timeToken.balanceOf(addresses[8].address);
            const totalSupply = await timeToken.TOTAL_SUPPLY();
            
            expect(liquidityBalance).to.equal((totalSupply * 500n) / 10000n); // 5%
            expect(insuranceBalance).to.equal((totalSupply * 500n) / 10000n); // 5%
        });
    });
});
