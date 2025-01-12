import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { MemeToken } from "../typechain";

const TOKEN_NAME = "TestMeme";
const TOKEN_SYMBOL = "TMEME";
const TOTAL_SUPPLY = ethers.parseUnits("1000000000", 18); // 1 billion tokens
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("GGMemeToken", function () {
  let token: MemeToken;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let marketing: SignerWithAddress;
  let provider: typeof ethers.provider;

  const features = {
    antiWhaleEnabled: true,
    cooldownEnabled: true,
    blacklistEnabled: true,
    autoBurnEnabled: true,
  };

  const fees = {
    liquidityFee: 2,
    marketingFee: 2,
    burnFee: 1,
  };

  const limits = {
    maxTransactionAmount: TOTAL_SUPPLY / 100n, // 1% of total supply
    maxWalletSize: (TOTAL_SUPPLY * 2n) / 100n, // 2% of total supply
    cooldownTime: 1800, // 30 minutes
  };

  beforeEach(async function () {
    [owner, addr1, addr2, marketing] = await ethers.getSigners();
    provider = ethers.provider;

    const Token = await ethers.getContractFactory("MemeToken");
    token = (await Token.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOTAL_SUPPLY,
      marketing.address,
      features,
      fees,
      limits
    )) as MemeToken;
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await token.balanceOf(owner.address);
      expect(await token.totalSupply()).to.equal(ownerBalance);
    });

    it("Should set correct initial parameters", async function () {
      const deployedFeatures = await token.getFeatures();
      const deployedFees = await token.getFees();
      const deployedLimits = await token.getLimits();

      expect(deployedFeatures.antiWhaleEnabled).to.equal(
        features.antiWhaleEnabled
      );
      expect(deployedFees.marketingFee).to.equal(fees.marketingFee);
      expect(deployedLimits.maxTransactionAmount).to.equal(
        limits.maxTransactionAmount
      );
    });

    it("Should properly set excluded addresses", async function () {
      expect(await token.isExcludedFromFees(owner.address)).to.be.true;
      expect(await token.isExcludedFromFees(marketing.address)).to.be.true;
      expect(await token.isExcludedFromFees(await token.getAddress())).to.be
        .true;
    });
  });

  describe("Feature Toggling", function () {
    it("Should toggle features correctly", async function () {
      await token.toggleFeature("antiWhaleEnabled", false);
      const features = await token.getFeatures();
      expect(features.antiWhaleEnabled).to.be.false;
    });

    it("Should only allow owner to toggle features", async function () {
      await expect(token.connect(addr1).toggleFeature("reflection", false)).to
        .be.reverted;
    });

    it("Should emit FeatureToggled event", async function () {
      await expect(token.toggleFeature("reflection", false))
        .to.emit(token, "FeatureToggled")
        .withArgs("reflection", false);
    });
  });

  describe("Fee Management", function () {
    it("Should update fees correctly", async function () {
      await token.updateFees(1, 1, 1);
      const newFees = await token.getFees();
      expect(newFees.liquidityFee).to.equal(1);
      expect(newFees.marketingFee).to.equal(1);
      expect(newFees.burnFee).to.equal(1);
    });

    it("Should reject fees totaling more than 25%", async function () {
      await expect(token.updateFees(10, 10, 10)).to.be.revertedWith(
        "Total fee too high"
      );
    });
  });

  describe("Trading Controls", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(addr1.address, ethers.parseUnits("1000000", 18));
    });

    it("Should enforce max transaction amount", async function () {
      const maxTx = await token
        .getLimits()
        .then((l: any) => l.maxTransactionAmount);
      await expect(
        token.connect(addr1).transfer(addr2.address, maxTx + 1n)
      ).to.be.revertedWith("Exceeds max transaction amount");
    });

    it("Should enforce max wallet size", async function () {
      const maxTx = await token
        .getLimits()
        .then((l: any) => l.maxTransactionAmount);
      const maxWallet = await token
        .getLimits()
        .then((l: any) => l.maxWalletSize);

      // Get current balance of addr2
      let currentBalance = await token.balanceOf(addr2.address);

      // Calculate how many transfers needed to reach under max wallet
      const transferAmount = maxTx - 1n;
      const transfersNeeded =
        (maxWallet - 1n - currentBalance) / transferAmount;

      // Perform transfers looping until just under maxWallet
      for (let i = 0; i < transfersNeeded; i++) {
        await token.connect(owner).transfer(addr2.address, transferAmount);
      }

      await expect(
        token.connect(owner).transfer(addr2.address, maxTx - 1n)
      ).to.be.revertedWith("Exceeds max wallet size");
    });

    it("Should enforce cooldown period", async function () {
      const amount = ethers.parseUnits("1000", 18);
      await token.connect(addr1).transfer(addr2.address, amount);
      await expect(
        token.connect(addr1).transfer(addr2.address, amount)
      ).to.be.revertedWith("Cooldown period active");
    });
  });

  describe("Blacklist Functionality", function () {
    it("Should blacklist and unblacklist addresses", async function () {
      await token.addToBlacklist(addr1.address, true);
      expect(await token.isBlacklisted(addr1.address)).to.be.true;

      await token.addToBlacklist(addr1.address, false);
      expect(await token.isBlacklisted(addr1.address)).to.be.false;
    });

    it("Should prevent blacklisted addresses from trading", async function () {
      await token.transfer(addr1.address, ethers.parseUnits("1000", 18));
      await token.addToBlacklist(addr1.address, true);

      await expect(
        token
          .connect(addr1)
          .transfer(addr2.address, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("Sender or recipient is blacklisted");
    });
  });

  describe("Fee Collection and Distribution", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(addr1.address, ethers.parseUnits("1000000", 18));
    });

    it("Should collect marketing fees", async function () {
      const marketingBalanceBefore = await token.balanceOf(marketing.address);
      await token
        .connect(addr1)
        .transfer(addr2.address, ethers.parseUnits("100000", 18));
      const marketingBalanceAfter = await token.balanceOf(marketing.address);

      expect(marketingBalanceAfter).to.be.gt(marketingBalanceBefore);
    });

    it("Should burn tokens when autoBurn is enabled", async function () {
      const burnAddress = "0x000000000000000000000000000000000000dEaD";
      const burnBalanceBefore = await token.balanceOf(burnAddress);
      await token
        .connect(addr1)
        .transfer(addr2.address, ethers.parseUnits("100000", 18));
      const burnBalanceAfter = await token.balanceOf(burnAddress);

      expect(burnBalanceAfter).to.be.gt(burnBalanceBefore);
    });
  });

  describe("Emergency Controls", function () {
    it("Should pause and unpause trading", async function () {
      await token.pause();
      await expect(
        token
          .connect(addr1)
          .transfer(addr2.address, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("Trading not enabled");

      await token.unpause();
      await token.transfer(addr1.address, ethers.parseUnits("100", 18));
      expect(await token.balanceOf(addr1.address)).to.equal(
        ethers.parseUnits("100", 18)
      );
    });
  });

  describe("Reflection Mechanism", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(addr1.address, ethers.parseUnits("1000000", 18));
    });

    it("Should distribute reflections to holders", async function () {
      await token.transfer(addr2.address, ethers.parseUnits("100000", 18));
      const initialBalance = await token.balanceOf(owner.address);

      await token
        .connect(owner)
        .transfer(addr2.address, ethers.parseUnits("50000", 18));

      const finalBalance = await token.balanceOf(owner.address);
      expect(finalBalance).to.be.lt(initialBalance);
    });
  });

  describe("Advanced Trading Scenarios", function () {
    beforeEach(async function () {
      await token.enableTrading();
      await token.transfer(addr1.address, ethers.parseUnits("1000000", 18));
    });

    it("Should handle multiple transfers correctly", async function () {
      for (let i = 0; i < 5; i++) {
        await token
          .connect(addr1)
          .transfer(addr2.address, ethers.parseUnits("1000", 18));
        await time.increase(limits.cooldownTime + 1);
      }

      const addr2Balance = await token.balanceOf(addr2.address);
      expect(addr2Balance).to.be.gt(ethers.parseUnits("4000", 18)); // Accounting for fees
    });

    it("Should apply whale tax for large transactions", async function () {
      const normalAmount = ethers.parseUnits("10000", 18);
      const whaleAmount = (limits.maxTransactionAmount * 51n) / 100n;

      // Normal transfer
      await token.connect(owner).transfer(addr1.address, normalAmount);
      const balanceBefore = await token.balanceOf(addr2.address);
      await token.connect(addr1).transfer(addr2.address, normalAmount);
      const balanceAfterNormal = await token.balanceOf(addr2.address);

      await time.increase(limits.cooldownTime + 1);

      // Whale transfer
      await token.connect(owner).transfer(addr1.address, whaleAmount);
      await token.connect(addr1).transfer(addr2.address, whaleAmount);
      const balanceAfterWhale = await token.balanceOf(addr2.address);

      // Calculate effective tax rates
      const normalTaxRate =
        ((normalAmount - (balanceAfterNormal - balanceBefore)) * 100n) /
        normalAmount;

      const whaleTaxRate =
        ((whaleAmount - (balanceAfterWhale - balanceAfterNormal)) * 100n) /
        whaleAmount;

      expect(whaleTaxRate).to.be.gt(normalTaxRate);
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should maintain reasonable gas costs for transfers", async function () {
      await token.enableTrading();
      await token.transfer(addr1.address, ethers.parseUnits("1000000", 18));

      const tx = await token
        .connect(addr1)
        .transfer(addr2.address, ethers.parseUnits("1000", 18));
      const receipt = await tx.wait();

      const gasUsed = BigInt(receipt!.gasUsed); // Defaults to 0 if receipt is null

      expect(Number(gasUsed)).to.be.lessThan(300000);
    });
  });
});
