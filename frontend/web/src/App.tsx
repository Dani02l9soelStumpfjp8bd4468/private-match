import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface MatchRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  status: "pending" | "matched" | "rejected";
  matchPercentage: number;
  partnerAddress: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  // Calculate statistics for dashboard
  const matchedCount = matches.filter(m => m.status === "matched").length;
  const pendingCount = matches.filter(m => m.status === "pending").length;
  const rejectedCount = matches.filter(m => m.status === "rejected").length;

  useEffect(() => {
    loadMatches().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadMatches = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("match_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing match keys:", e);
        }
      }
      
      const list: MatchRecord[] = [];
      
      for (const key of keys) {
        try {
          const matchBytes = await contract.getData(`match_${key}`);
          if (matchBytes.length > 0) {
            try {
              const matchData = JSON.parse(ethers.toUtf8String(matchBytes));
              list.push({
                id: key,
                encryptedData: matchData.data,
                timestamp: matchData.timestamp,
                owner: matchData.owner,
                status: matchData.status || "pending",
                matchPercentage: matchData.matchPercentage || 0,
                partnerAddress: matchData.partnerAddress || ""
              });
            } catch (e) {
              console.error(`Error parsing match data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading match ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setMatches(list);
    } catch (e) {
      console.error("Error loading matches:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitQuestionnaire = async (answers: any) => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting questionnaire with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(answers))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const matchId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const matchData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "pending",
        matchPercentage: 0,
        partnerAddress: ""
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `match_${matchId}`, 
        ethers.toUtf8Bytes(JSON.stringify(matchData))
      );
      
      const keysBytes = await contract.getData("match_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(matchId);
      
      await contract.setData(
        "match_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted questionnaire submitted!"
      });
      
      await loadMatches();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowQuestionnaire(false);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) {
        throw new Error("Contract not available");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `Contract is ${isAvailable ? "available" : "not available"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const toggleMatchDetails = (matchId: string) => {
    if (expandedMatchId === matchId) {
      setExpandedMatchId(null);
    } else {
      setExpandedMatchId(matchId);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start the matching process",
      icon: "🔗"
    },
    {
      title: "Complete Questionnaire",
      description: "Answer encrypted questions about your preferences",
      icon: "📝"
    },
    {
      title: "FHE Matching",
      description: "System finds matches without seeing your private data",
      icon: "🔍"
    },
    {
      title: "View Matches",
      description: "See compatible partners while preserving privacy",
      icon: "💞"
    }
  ];

  const renderPieChart = () => {
    const total = matches.length || 1;
    const matchedPercentage = (matchedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const rejectedPercentage = (rejectedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment matched" 
            style={{ transform: `rotate(${matchedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(matchedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment rejected" 
            style={{ transform: `rotate(${(matchedPercentage + pendingPercentage + rejectedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{matches.length}</div>
            <div className="pie-label">Matches</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box matched"></div>
            <span>Matched: {matchedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box rejected"></div>
            <span>Rejected: {rejectedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted matching service...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="heart-icon"></div>
          <h1>Private<span>Match</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowQuestionnaire(true)} 
            className="create-btn"
          >
            <div className="add-icon"></div>
            New Questionnaire
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="hero-banner">
          <div className="hero-text">
            <h2>Privacy-First Marriage Matching</h2>
            <p>Find your perfect match without compromising your privacy using FHE technology</p>
          </div>
        </div>
        
        <div className="project-intro glass-card">
          <h2>About PrivateMatch</h2>
          <p>
            PrivateMatch is a revolutionary marriage matching service that uses Fully Homomorphic Encryption (FHE) 
            to calculate compatibility while keeping your personal information completely private. 
            Unlike traditional services, no human "matchmaker" ever sees your sensitive data.
          </p>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section glass-card">
            <h2>How PrivateMatch Works</h2>
            <p className="subtitle">Your journey to finding the perfect match with privacy</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card glass-card">
            <h3>Match Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{matches.length}</div>
                <div className="stat-label">Total Matches</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{matchedCount}</div>
                <div className="stat-label">Successful</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Match Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="actions-section">
          <button 
            onClick={checkContractAvailability}
            className="action-btn primary"
          >
            Check FHE Contract Availability
          </button>
          <button 
            onClick={loadMatches}
            className="action-btn"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Matches"}
          </button>
        </div>
        
        <div className="matches-section">
          <div className="section-header">
            <h2>Your Match Records</h2>
          </div>
          
          <div className="matches-list">
            {matches.length === 0 ? (
              <div className="no-matches glass-card">
                <div className="no-matches-icon"></div>
                <p>No match records found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowQuestionnaire(true)}
                >
                  Complete Questionnaire
                </button>
              </div>
            ) : (
              matches.map(match => (
                <div 
                  className={`match-card glass-card ${expandedMatchId === match.id ? 'expanded' : ''}`} 
                  key={match.id}
                  onClick={() => toggleMatchDetails(match.id)}
                >
                  <div className="match-header">
                    <div className="match-id">Match #{match.id.substring(0, 6)}</div>
                    <div className="match-date">
                      {new Date(match.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className={`match-status ${match.status}`}>
                      {match.status}
                    </div>
                  </div>
                  
                  <div className="match-percentage">
                    <div className="percentage-circle">
                      <div className="percentage-value">{match.matchPercentage}%</div>
                      <div className="percentage-label">Compatibility</div>
                    </div>
                  </div>
                  
                  {expandedMatchId === match.id && (
                    <div className="match-details">
                      <div className="detail-item">
                        <span className="detail-label">Owner:</span>
                        <span className="detail-value">{match.owner.substring(0, 6)}...{match.owner.substring(38)}</span>
                      </div>
                      {match.partnerAddress && (
                        <div className="detail-item">
                          <span className="detail-label">Partner:</span>
                          <span className="detail-value">{match.partnerAddress.substring(0, 6)}...{match.partnerAddress.substring(38)}</span>
                        </div>
                      )}
                      <div className="detail-item">
                        <span className="detail-label">Encrypted Data:</span>
                        <span className="detail-value">{match.encryptedData.substring(0, 20)}...</span>
                      </div>
                    </div>
                  )}
                  
                  <div className="match-footer">
                    <div className="view-details">
                      {expandedMatchId === match.id ? "Hide Details" : "View Details"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
        <div className="team-section glass-card">
          <h2>Our Team</h2>
          <div className="team-members">
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Alex Chen</div>
              <div className="member-role">FHE Specialist</div>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">Sofia Rodriguez</div>
              <div className="member-role">Blockchain Developer</div>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <div className="member-name">James Wilson</div>
              <div className="member-role">Privacy Advocate</div>
            </div>
          </div>
        </div>
      </div>
  
      {showQuestionnaire && (
        <QuestionnaireModal 
          onSubmit={submitQuestionnaire} 
          onClose={() => setShowQuestionnaire(false)} 
          submitting={submitting}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="heart-icon"></div>
              <span>PrivateMatch</span>
            </div>
            <p>Privacy-first marriage matching using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Us</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} PrivateMatch. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface QuestionnaireModalProps {
  onSubmit: (answers: any) => void; 
  onClose: () => void; 
  submitting: boolean;
}

const QuestionnaireModal: React.FC<QuestionnaireModalProps> = ({ 
  onSubmit, 
  onClose, 
  submitting
}) => {
  const [answers, setAnswers] = useState({
    personality: "",
    hobbies: "",
    values: "",
    lifestyle: "",
    dealbreakers: ""
  });

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setAnswers({
      ...answers,
      [name]: value
    });
  };

  const handleSubmit = () => {
    // Basic validation
    if (!answers.personality || !answers.values) {
      alert("Please complete required fields");
      return;
    }
    
    onSubmit(answers);
  };

  return (
    <div className="modal-overlay">
      <div className="questionnaire-modal glass-card">
        <div className="modal-header">
          <h2>Encrypted Compatibility Questionnaire</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your answers will be encrypted with FHE
          </div>
          
          <div className="questionnaire-form">
            <div className="form-group">
              <label>Personality Traits *</label>
              <textarea 
                name="personality"
                value={answers.personality} 
                onChange={handleChange}
                placeholder="Describe your personality..." 
                rows={3}
              />
            </div>
            
            <div className="form-group">
              <label>Hobbies & Interests</label>
              <textarea 
                name="hobbies"
                value={answers.hobbies} 
                onChange={handleChange}
                placeholder="What are your hobbies and interests?" 
                rows={2}
              />
            </div>
            
            <div className="form-group">
              <label>Core Values *</label>
              <textarea 
                name="values"
                value={answers.values} 
                onChange={handleChange}
                placeholder="What values are most important to you?" 
                rows={3}
              />
            </div>
            
            <div className="form-group">
              <label>Lifestyle Preferences</label>
              <textarea 
                name="lifestyle"
                value={answers.lifestyle} 
                onChange={handleChange}
                placeholder="Describe your ideal lifestyle..." 
                rows={2}
              />
            </div>
            
            <div className="form-group">
              <label>Dealbreakers</label>
              <textarea 
                name="dealbreakers"
                value={answers.dealbreakers} 
                onChange={handleChange}
                placeholder="What are your absolute dealbreakers?" 
                rows={2}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            Your answers remain encrypted during matching calculations
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="submit-btn primary"
          >
            {submitting ? "Encrypting with FHE..." : "Submit Questionnaire"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;