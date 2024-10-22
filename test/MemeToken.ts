import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { GGMemeToken } from "../typechain";

const TOKEN_NAME = "TestMeme";
const TOKEN_SYMBOL = "TMEME";
const TOTAL_SUPPLY = ethers.parseUnits("1000000000", 18); // 1 billion tokens
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("GGMemeToken", function () {
  let Token: Contract;
  let token: Contract;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let marketing: SignerWithAddress;
  let router: SignerWithAddress;
  let provider: typeof ethers.provider;

  const features = {
    reflectionEnabled: true,
    antiWhaleEnabled: true,
    autoLiquidityEnabled: true,
    cooldownEnabled: true,
    blacklistEnabled: true,
    autoBurnEnabled: true,
  };

  const fees = {
    reflectionFee: 2,
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
    [owner, addr1, addr2, marketing, router] = await ethers.getSigners();
    provider = ethers.provider;

    Token = await ethers.getContractFactory("GGMemeToken");
    token = await Token.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOTAL_SUPPLY,
      marketing.address,
      router.address,
      features,
      fees,
      limits
    );
    await token.deployed();
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

      expect(deployedFeatures.reflectionEnabled).to.equal(
        features.reflectionEnabled
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
      await token.toggleFeature("reflection", false);
      const features = await token.getFeatures();
      expect(features.reflectionEnabled).to.be.false;
    });

    it("Should only allow owner to toggle features", async function () {
      await expect(
        token.connect(addr1).toggleFeature("reflection", false)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should emit FeatureToggled event", async function () {
      await expect(token.toggleFeature("reflection", false))
        .to.emit(token, "FeatureToggled")
        .withArgs("reflection", false);
    });
  });

  describe("Fee Management", function () {
    it("Should update fees correctly", async function () {
      await token.updateFees(1, 1, 1, 1);
      const newFees = await token.getFees();
      expect(newFees.reflectionFee).to.equal(1);
      expect(newFees.liquidityFee).to.equal(1);
      expect(newFees.marketingFee).to.equal(1);
      expect(newFees.burnFee).to.equal(1);
    });

    it("Should reject fees totaling more than 25%", async function () {
      await expect(token.updateFees(10, 10, 10, 10)).to.be.revertedWith(
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
        token.connect(addr1).transfer(addr2.address, maxTx.add(1))
      ).to.be.revertedWith("Exceeds max tx");
    });

    it("Should enforce max wallet size", async function () {
      const maxWallet = await token
        .getLimits()
        .then((l: any) => l.maxWalletSize);
      await expect(
        token.connect(addr1).transfer(addr2.address, maxWallet.add(1))
      ).to.be.revertedWith("Exceeds wallet max");
    });

    it("Should enforce cooldown period", async function () {
      const amount = ethers.parseUnits("1000", 18);
      await token.connect(addr1).transfer(addr2.address, amount);
      await expect(
        token.connect(addr1).transfer(addr2.address, amount)
      ).to.be.revertedWith("Cooldown active");
    });
  });

  describe("Blacklist Functionality", function () {
    it("Should blacklist and unblacklist addresses", async function () {
      await token.setBlacklist(addr1.address, true);
      expect(await token.isBlacklisted(addr1.address)).to.be.true;

      await token.setBlacklist(addr1.address, false);
      expect(await token.isBlacklisted(addr1.address)).to.be.false;
    });

    it("Should prevent blacklisted addresses from trading", async function () {
      await token.transfer(addr1.address, ethers.parseUnits("1000", 18));
      await token.setBlacklist(addr1.address, true);

      await expect(
        token
          .connect(addr1)
          .transfer(addr2.address, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("Blacklisted");
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
      ).to.be.revertedWith("Pausable: paused");

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
        .connect(addr1)
        .transfer(addr2.address, ethers.parseUnits("50000", 18));

      const finalBalance = await token.balanceOf(owner.address);
      expect(finalBalance).to.be.gt(initialBalance);
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
      const whaleAmount = limits.maxTransactionAmount.mul(51).div(100);

      // Normal transfer
      const balanceBefore = await token.balanceOf(addr2.address);
      await token.connect(addr1).transfer(addr2.address, normalAmount);
      const balanceAfterNormal = await token.balanceOf(addr2.address);

      await time.increase(limits.cooldownTime + 1);

      // Whale transfer
      await token.connect(addr1).transfer(addr2.address, whaleAmount);
      const balanceAfterWhale = await token.balanceOf(addr2.address);

      // Calculate effective tax rates
      const normalTaxRate = normalAmount
        .sub(balanceAfterNormal.sub(balanceBefore))
        .mul(100)
        .div(normalAmount);
      const whaleTaxRate = whaleAmount
        .sub(balanceAfterWhale.sub(balanceAfterNormal))
        .mul(100)
        .div(whaleAmount);

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

      expect(receipt.gasUsed.toNumber()).to.be.lt(300000); // Adjust threshold as needed
    });
  });
});
