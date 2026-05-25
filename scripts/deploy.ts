import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // For Arc Testnet, the USDC address is native/system contract
  // 0x3600000000000000000000000000000000000000
  const usdcAddress = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";

  console.log("Using USDC address:", usdcAddress);

  // Deploy CypherLexicon
  const CypherLexicon = await ethers.getContractFactory("CypherLexicon");
  const lexicon = await CypherLexicon.deploy(usdcAddress);

  await lexicon.waitForDeployment();

  const lexiconAddress = await lexicon.getAddress();
  console.log("=========================================");
  console.log("🎉 CypherLexicon deployed to:", lexiconAddress);
  console.log("=========================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
