import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  Alert,
  AlertIcon,
  useToast,
  InputGroup,
  InputRightElement,
} from '@chakra-ui/react';
import { login, register } from '../../store/authSlice';

const LoginForm = ({ initialMode = 'login' }) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  
  const { error, loading } = useSelector((state) => state.auth);
  
  useEffect(() => {
    setIsLogin(initialMode === 'login');
  }, [initialMode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (isLogin) {
      const success = await dispatch(login({ username, password }));
      
      if (success) {
        toast({
          title: 'Login successful',
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
        navigate('/');
      }
    } else {
      const success = await dispatch(register({ username, password, email }));
      
      if (success) {
        toast({
          title: 'Registration successful',
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
        navigate('/');
      }
    }
  };
  
  return (
    <Box maxW="md" mx="auto" mt={8} p={6} borderWidth={1} borderRadius="lg" boxShadow="lg">
      <VStack spacing={4} align="stretch">
        <Heading textAlign="center">
          {isLogin ? 'Login to Kekopoly' : 'Create an Account'}
        </Heading>
        
        {error && (
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            {error}
          </Alert>
        )}
        
        <form onSubmit={handleSubmit}>
          <VStack spacing={4}>
            <FormControl isRequired>
              <FormLabel>Username</FormLabel>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
              />
            </FormControl>
            
            <FormControl isRequired>
              <FormLabel>Password</FormLabel>
              <InputGroup>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                />
                <InputRightElement width="4.5rem">
                  <Button
                    h="1.75rem"
                    size="sm"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </Button>
                </InputRightElement>
              </InputGroup>
            </FormControl>
            
            {!isLogin && (
              <FormControl isRequired>
                <FormLabel>Email</FormLabel>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                />
              </FormControl>
            )}
            
            <Button
              colorScheme="green"
              width="full"
              type="submit"
              isLoading={loading}
              loadingText={isLogin ? "Logging in..." : "Registering..."}
              mt={4}
            >
              {isLogin ? 'Login' : 'Register'}
            </Button>
          </VStack>
        </form>
        
        <Text textAlign="center" mt={4}>
          {isLogin ? "Don't have an account?" : "Already have an account?"}
          <Button
            variant="link"
            colorScheme="blue"
            onClick={() => setIsLogin(!isLogin)}
            ml={2}
          >
            {isLogin ? 'Register' : 'Login'}
          </Button>
        </Text>
      </VStack>
    </Box>
  );
};

export default LoginForm;